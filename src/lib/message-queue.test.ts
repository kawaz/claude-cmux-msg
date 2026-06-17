import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import {
  insertMessage,
  getMessage,
  tryClaimMessage,
  listPendingForTarget,
  listConsumedBySid,
  deleteOldConsumed,
  type MessageRow,
  type TargetKind,
} from "./message-queue";

function makeMsg(msgId: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    msgId,
    fromSid: "from-sid",
    fromWsHash: null,
    fromRepoHash: "repo-h",
    fromCwdHash: "cwd-h",
    fromLabels: ["team-a"],
    fromHome: "/home",
    targetKind: "sid" as TargetKind,
    targetValue: "to-sid",
    bodyPath: "/tmp/body.md",
    priority: 0,
    createdAt: 1000,
    consumedBy: null,
    consumedAt: null,
    originalTargetSid: null,
    originalTargetKind: null,
    alsoReceivedBy: null,
    ...overrides,
  };
}

describe("message-queue", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccmsg-mq-test-"));
    db = openDb(path.join(tmpDir, "x.db"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("insert + get でラウンドトリップ (labels JSON parse 含む)", () => {
    const r = makeMsg("m1", {
      alsoReceivedBy: ["a", "b"],
      originalTargetSid: "orig-sid",
      originalTargetKind: "sid",
    });
    insertMessage(db, r);
    expect(getMessage(db, "m1")).toEqual(r);
  });

  test("insert で重複 msg_id は throw", () => {
    insertMessage(db, makeMsg("m1"));
    expect(() => insertMessage(db, makeMsg("m1"))).toThrow();
  });

  test("不正な target_kind は throw", () => {
    expect(() =>
      insertMessage(db, makeMsg("m1", { targetKind: "bogus" as TargetKind })),
    ).toThrow(/invalid target_kind/);
  });

  test("tryClaimMessage 初回成功、2 回目は失敗 (取った者勝ち)", () => {
    insertMessage(db, makeMsg("m1"));
    expect(tryClaimMessage(db, "m1", "sid-a", 100)).toBe(true);
    expect(tryClaimMessage(db, "m1", "sid-b", 200)).toBe(false);
    const got = getMessage(db, "m1");
    expect(got?.consumedBy).toBe("sid-a");
    expect(got?.consumedAt).toBe(100);
  });

  test("tryClaimMessage 存在しない msg_id は false", () => {
    expect(tryClaimMessage(db, "nope", "sid-a")).toBe(false);
  });

  test("listPendingForTarget は consumed_by IS NULL のみ、priority DESC + created_at ASC", () => {
    insertMessage(db, makeMsg("m1", { targetValue: "T", priority: 0, createdAt: 100 }));
    insertMessage(db, makeMsg("m2", { targetValue: "T", priority: 1, createdAt: 200 }));
    insertMessage(db, makeMsg("m3", { targetValue: "T", priority: 0, createdAt: 50 }));
    insertMessage(db, makeMsg("m4", { targetValue: "T", priority: 0, createdAt: 60 }));
    tryClaimMessage(db, "m4", "sid-x");
    const xs = listPendingForTarget(db, "sid", "T").map((r) => r.msgId);
    // m4 は consumed なので除外、優先度高 (m2) → 低 (m3, m1) で並ぶ
    expect(xs).toEqual(["m2", "m3", "m1"]);
  });

  test("listPendingForTarget は別 target を混ぜない", () => {
    insertMessage(db, makeMsg("m1", { targetValue: "A" }));
    insertMessage(db, makeMsg("m2", { targetValue: "B" }));
    expect(listPendingForTarget(db, "sid", "A").map((r) => r.msgId)).toEqual([
      "m1",
    ]);
  });

  test("listConsumedBySid は consumed_at DESC", () => {
    insertMessage(db, makeMsg("m1"));
    insertMessage(db, makeMsg("m2"));
    insertMessage(db, makeMsg("m3"));
    tryClaimMessage(db, "m1", "sid-x", 100);
    tryClaimMessage(db, "m3", "sid-x", 300);
    tryClaimMessage(db, "m2", "sid-y", 200);
    const xs = listConsumedBySid(db, "sid-x").map((r) => r.msgId);
    expect(xs).toEqual(["m3", "m1"]);
  });

  test("deleteOldConsumed: 未取得は削除しない、取得済 + created_at < beforeTs のみ", () => {
    insertMessage(db, makeMsg("m1", { createdAt: 100 }));
    insertMessage(db, makeMsg("m2", { createdAt: 500 }));
    insertMessage(db, makeMsg("m3", { createdAt: 100 }));
    tryClaimMessage(db, "m1", "sid-x");
    tryClaimMessage(db, "m2", "sid-x");
    // m3 は未取得 → cutoff 内でも消えない
    const n = deleteOldConsumed(db, 200);
    expect(n).toBe(1); // m1 だけ
    expect(getMessage(db, "m1")).toBeNull();
    expect(getMessage(db, "m2")).not.toBeNull();
    expect(getMessage(db, "m3")).not.toBeNull();
  });

  test("fromLabels が null でも OK", () => {
    insertMessage(db, makeMsg("m1", { fromLabels: null }));
    expect(getMessage(db, "m1")?.fromLabels).toBeNull();
  });
});
