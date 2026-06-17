import { describe, test, expect } from "bun:test";
import { parseSendArgs, resolveSendBody } from "./send";
import { UsageError } from "../lib/errors";

const TARGET = "11111111-1111-1111-1111-111111111111";

describe("parseSendArgs", () => {
  test("<id> のみ: target だけ、text は undefined", () => {
    const r = parseSendArgs([TARGET]);
    expect(r.target).toBe(TARGET);
    expect(r.text).toBeUndefined();
  });

  test("--text <msg>", () => {
    const r = parseSendArgs([TARGET, "--text", "hello"]);
    expect(r.target).toBe(TARGET);
    expect(r.text).toBe("hello");
  });

  test("--text=<msg>", () => {
    const r = parseSendArgs([TARGET, "--text=hello world"]);
    expect(r.text).toBe("hello world");
  });

  test("positional 本文は usage error (DR-0014)", () => {
    expect(() => parseSendArgs([TARGET, "hello"])).toThrow(UsageError);
  });

  test("positional 本文複数も usage error", () => {
    expect(() => parseSendArgs([TARGET, "hello", "world"])).toThrow(UsageError);
  });

  test("引数なしは UsageError", () => {
    expect(() => parseSendArgs([])).toThrow(UsageError);
  });

  test("--text の値欠落は UsageError", () => {
    expect(() => parseSendArgs([TARGET, "--text"])).toThrow(UsageError);
  });

  test("未知の long フラグ (--file=...) は UsageError", () => {
    expect(() =>
      parseSendArgs([TARGET, "--file=msg.md"])
    ).toThrow(UsageError);
  });

  test("未知の long フラグ (--type=...) は UsageError", () => {
    expect(() =>
      parseSendArgs([TARGET, "--type=response"])
    ).toThrow(UsageError);
  });

  test("未知の long フラグ (--in-reply-to=...) は UsageError", () => {
    expect(() =>
      parseSendArgs([TARGET, "--in-reply-to=20260612T090811-ccc4e03d.md"])
    ).toThrow(UsageError);
  });

  test("未知の short フラグ (-m) は UsageError", () => {
    expect(() => parseSendArgs([TARGET, "-m", "本文"])).toThrow(UsageError);
  });

  test("send の UsageError は reply への誘導を含む", () => {
    expect(() =>
      parseSendArgs([TARGET, "--in-reply-to=x.md"])
    ).toThrow(/reply/);
  });
});

describe("resolveSendBody", () => {
  test("--text 指定があればそのまま返す", async () => {
    const r = await resolveSendBody({ target: TARGET, text: "hello" });
    expect(r).toBe("hello");
  });
});
