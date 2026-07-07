import { describe, test, expect } from "bun:test";
import { filterListable } from "./list";
import type { InboxMessage } from "../lib/inbox";

function msg(overrides: Partial<InboxMessage>): InboxMessage {
  return {
    filename: "20260101T000000-deadbeef.md",
    from: "11111111-1111-1111-1111-111111111111",
    priority: "normal",
    type: "request",
    created_at: "2026-01-01T00:00:00+09:00",
    in_reply_to: null,
    broadcast_id: null,
    ...overrides,
  };
}

describe("filterListable", () => {
  test("空配列はそのまま空配列", () => {
    expect(filterListable([])).toEqual([]);
  });

  // notify は subscribe stream に本文同梱で即時 emit 済み (DR-0017)。
  // list に出続けると「読んだはずの通知」が context の無駄として残るので除外する。
  test("type=notify は除外される", () => {
    const m = msg({ type: "notify" });
    expect(filterListable([m])).toEqual([]);
  });

  test.each(["request", "response", "broadcast"])(
    "type=%s は除外されない",
    (type) => {
      const m = msg({ type });
      expect(filterListable([m])).toEqual([m]);
    },
  );

  test("notify とその他が混在: notify だけ除外し順序を維持", () => {
    const a = msg({ filename: "a.md", type: "request" });
    const n = msg({ filename: "n.md", type: "notify" });
    const b = msg({ filename: "b.md", type: "response" });
    expect(filterListable([a, n, b])).toEqual([a, b]);
  });
});
