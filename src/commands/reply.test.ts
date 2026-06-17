import { describe, expect, test } from "bun:test";
import { parseReplyArgs } from "./reply";
import { UsageError } from "../lib/errors";

const FILE = "20260612T090811-ccc4e03d.md";

describe("parseReplyArgs", () => {
  test("<filename> のみ: filename だけ、text は undefined", () => {
    const r = parseReplyArgs([FILE]);
    expect(r.filename).toBe(FILE);
    expect(r.text).toBeUndefined();
  });

  test("--text <msg>", () => {
    const r = parseReplyArgs([FILE, "--text", "了解しました"]);
    expect(r.filename).toBe(FILE);
    expect(r.text).toBe("了解しました");
  });

  test("--text=<msg>", () => {
    const r = parseReplyArgs([FILE, "--text=ok"]);
    expect(r.text).toBe("ok");
  });

  test("positional 本文は usage error (DR-0014)", () => {
    expect(() => parseReplyArgs([FILE, "了解"])).toThrow(UsageError);
  });

  test("引数なしは UsageError", () => {
    expect(() => parseReplyArgs([])).toThrow(UsageError);
  });

  test("--text の値欠落は UsageError", () => {
    expect(() => parseReplyArgs([FILE, "--text"])).toThrow(UsageError);
  });

  test("未知の short フラグ (-m) は UsageError", () => {
    expect(() => parseReplyArgs([FILE, "-m", "本文"])).toThrow(UsageError);
  });

  test("未知の long フラグ (--type=...) は UsageError", () => {
    expect(() => parseReplyArgs([FILE, "--type=x"])).toThrow(UsageError);
  });
});
