import { describe, test, expect } from "bun:test";
import {
  diffInbox,
  decideNotify,
  NOTIFY_TTL_MS,
  NOTIFY_CATCH_UP_SECONDS,
} from "./subscribe";

describe("diffInbox", () => {
  test("emitted 空で current が空なら何も emit せず", () => {
    const r = diffInbox(new Set(), []);
    expect(r.toEmit).toEqual([]);
    expect([...r.nextEmitted]).toEqual([]);
  });

  test("起動時一括: emitted 空 + current 複数 → 全件 emit", () => {
    const current = [
      { filename: "a.md", from: "X", priority: "normal" },
      { filename: "b.md", from: "Y", priority: "urgent" },
    ];
    const r = diffInbox(new Set(), current);
    expect(r.toEmit).toEqual(current);
    expect([...r.nextEmitted].sort()).toEqual(["a.md", "b.md"]);
  });

  test("差分 emit: emitted に既存、new 追加分のみ emit", () => {
    const current = [
      { filename: "a.md", from: "X", priority: "normal" },
      { filename: "b.md", from: "Y", priority: "normal" },
      { filename: "c.md", from: "Z", priority: "normal" },
    ];
    const r = diffInbox(new Set(["a.md"]), current);
    expect(r.toEmit.map((m) => m.filename)).toEqual(["b.md", "c.md"]);
    expect([...r.nextEmitted].sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  test("accept/dismiss 済み掃除: current に無い emitted は next から落とす", () => {
    const current = [{ filename: "b.md", from: "Y", priority: "normal" }];
    const r = diffInbox(new Set(["a.md", "b.md"]), current);
    expect(r.toEmit).toEqual([]);
    expect([...r.nextEmitted]).toEqual(["b.md"]);
  });

  test("全件掃除: current 空なら nextEmitted も空", () => {
    const r = diffInbox(new Set(["a.md", "b.md"]), []);
    expect(r.toEmit).toEqual([]);
    expect([...r.nextEmitted]).toEqual([]);
  });

  test("複合: 掃除と新規が同時", () => {
    // emitted に a,b / current に b,c → a を忘れ、c を emit
    const current = [
      { filename: "b.md", from: "Y", priority: "normal" },
      { filename: "c.md", from: "Z", priority: "urgent" },
    ];
    const r = diffInbox(new Set(["a.md", "b.md"]), current);
    expect(r.toEmit.map((m) => m.filename)).toEqual(["c.md"]);
    expect([...r.nextEmitted].sort()).toEqual(["b.md", "c.md"]);
  });
});

describe("decideNotify (DR-0018)", () => {
  const subscribeStartedAt = 1_000_000_000; // 任意の wall clock
  const catchUp = NOTIFY_CATCH_UP_SECONDS;

  test("起動時刻直後の notify → emit", () => {
    const now = subscribeStartedAt + 1000;
    const createdAt = subscribeStartedAt + 500;
    expect(decideNotify(createdAt, now, subscribeStartedAt, catchUp)).toBe(
      "emit",
    );
  });

  test("起動時刻の catch-up window 内 → emit (タイムラグ救済)", () => {
    const now = subscribeStartedAt + 1000;
    const createdAt = subscribeStartedAt - 30 * 1000; // 30 秒前
    expect(decideNotify(createdAt, now, subscribeStartedAt, catchUp)).toBe(
      "emit",
    );
  });

  test("起動時刻 - catch-up window より古い → skip (= 陳腐化、誤実行リスク)", () => {
    const now = subscribeStartedAt + 1000;
    const createdAt = subscribeStartedAt - (catchUp + 1) * 1000; // 61 秒前
    expect(decideNotify(createdAt, now, subscribeStartedAt, catchUp)).toBe(
      "skip",
    );
  });

  test("TTL 超過 → unlink (catch-up より優先)", () => {
    // TTL 超過は catch-up 関係なく unlink。catch-up 内でも unlink を優先
    const createdAt = subscribeStartedAt;
    const now = createdAt + NOTIFY_TTL_MS + 1000;
    expect(decideNotify(createdAt, now, subscribeStartedAt, catchUp)).toBe(
      "unlink",
    );
  });

  test("TTL ぎりぎり (= TTL ちょうど) → emit (= 不等号は > のみ unlink)", () => {
    const createdAt = subscribeStartedAt;
    const now = createdAt + NOTIFY_TTL_MS;
    expect(decideNotify(createdAt, now, subscribeStartedAt, catchUp)).toBe(
      "emit",
    );
  });

  test("createdAt が NaN → emit (安全側、消さない)", () => {
    const now = subscribeStartedAt + 1000;
    expect(decideNotify(NaN, now, subscribeStartedAt, catchUp)).toBe("emit");
  });

  test("catchUpSeconds=0 で起動時刻直前の notify → skip", () => {
    const now = subscribeStartedAt + 1000;
    const createdAt = subscribeStartedAt - 1; // 1ms 前
    expect(decideNotify(createdAt, now, subscribeStartedAt, 0)).toBe("skip");
  });

  test("catchUpSeconds=0 で起動時刻ジャストの notify → emit", () => {
    const now = subscribeStartedAt + 1000;
    const createdAt = subscribeStartedAt;
    expect(decideNotify(createdAt, now, subscribeStartedAt, 0)).toBe("emit");
  });
});
