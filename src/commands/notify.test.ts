import { describe, test, expect } from "bun:test";
import { parseNotifyArgs, resolveNotifyBody } from "./notify";
import { UsageError } from "../lib/errors";

const SID = "22222222-2222-2222-2222-222222222222";

describe("parseNotifyArgs", () => {
  test("--self のみ: target は null", () => {
    const r = parseNotifyArgs(["--self"]);
    expect(r.target).toBeNull();
    expect(r.text).toBeUndefined();
  });

  test("--self --text <msg>", () => {
    const r = parseNotifyArgs(["--self", "--text", "do X"]);
    expect(r.target).toBeNull();
    expect(r.text).toBe("do X");
  });

  test("--self --text=<msg>", () => {
    const r = parseNotifyArgs(["--self", "--text=hello world"]);
    expect(r.text).toBe("hello world");
  });

  test("--to <sid>", () => {
    const r = parseNotifyArgs(["--to", SID]);
    expect(r.target).toBe(SID);
  });

  test("--to=<sid>", () => {
    const r = parseNotifyArgs([`--to=${SID}`]);
    expect(r.target).toBe(SID);
  });

  test("--to と --self の同時指定は UsageError", () => {
    expect(() => parseNotifyArgs(["--to", SID, "--self"])).toThrow(UsageError);
    expect(() => parseNotifyArgs(["--self", "--to", SID])).toThrow(UsageError);
  });

  test("--to も --self も無いと UsageError", () => {
    expect(() => parseNotifyArgs([])).toThrow(UsageError);
    expect(() => parseNotifyArgs(["--text", "hello"])).toThrow(UsageError);
  });

  test("positional 引数は UsageError (DR-0014)", () => {
    expect(() => parseNotifyArgs(["--self", "hello"])).toThrow(UsageError);
    expect(() => parseNotifyArgs(["--self", "hello", "world"])).toThrow(
      UsageError,
    );
  });

  test("--to の値欠落は UsageError", () => {
    expect(() => parseNotifyArgs(["--to"])).toThrow(UsageError);
  });

  test("--text の値欠落は UsageError", () => {
    expect(() => parseNotifyArgs(["--self", "--text"])).toThrow(UsageError);
  });

  test("未知の long フラグは UsageError", () => {
    expect(() => parseNotifyArgs(["--self", "--ttl=30"])).toThrow(UsageError);
  });

  test("未知の short フラグは UsageError", () => {
    expect(() => parseNotifyArgs(["--self", "-m", "x"])).toThrow(UsageError);
  });
});

describe("resolveNotifyBody", () => {
  test("--text 指定があればそのまま返す", async () => {
    const r = await resolveNotifyBody({ target: null, text: "hello" });
    expect(r).toBe("hello");
  });
});
