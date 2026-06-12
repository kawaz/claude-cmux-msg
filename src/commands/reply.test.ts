import { describe, expect, test } from "bun:test";
import { parseReplyArgs } from "./reply";
import { UsageError } from "../lib/errors";

const FILE = "20260612T090811-ccc4e03d.md";

describe("parseReplyArgs", () => {
  test("従来の <filename> <body...> 形式: body を join", () => {
    const r = parseReplyArgs([FILE, "了解", "しました"]);
    expect(r.filename).toBe(FILE);
    expect(r.body).toBe("了解 しました");
  });

  test("引数不足 (filename のみ) は UsageError", () => {
    expect(() => parseReplyArgs([FILE])).toThrow(UsageError);
  });

  test("引数なしは UsageError", () => {
    expect(() => parseReplyArgs([])).toThrow(UsageError);
  });

  test("未知の short フラグ (-m) は UsageError", () => {
    expect(() => parseReplyArgs([FILE, "-m", "本文"])).toThrow(UsageError);
  });

  test("未知の long フラグ (--type=...) は UsageError", () => {
    expect(() => parseReplyArgs([FILE, "--type=x", "本文"])).toThrow(
      UsageError
    );
  });

  test("-- セパレータ以降は - 始まりでも本文として扱う", () => {
    const r = parseReplyArgs([FILE, "--", "-m", "本文"]);
    expect(r.body).toBe("-m 本文");
  });

  test("本文中の途中の - 始まり語も弾く (セパレータ無し)", () => {
    expect(() => parseReplyArgs([FILE, "hello", "-x"])).toThrow(UsageError);
  });
});
