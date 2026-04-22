import { describe, test, expect } from "bun:test";
import { diffInbox } from "./subscribe";

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
