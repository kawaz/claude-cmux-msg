import { describe, expect, test } from "bun:test";
import { parseBroadcastArgs } from "./broadcast";
import { UsageError } from "../lib/errors";

describe("parseBroadcastArgs", () => {
  test("引数なし (stdin 経由想定): help=false, text=undefined", () => {
    const r = parseBroadcastArgs([]);
    expect(r.help).toBe(false);
    expect(r.all).toBe(false);
    expect(r.axes.length).toBe(0);
    expect(r.text).toBeUndefined();
  });

  test("--text のみ", () => {
    const r = parseBroadcastArgs(["--text", "build 通った"]);
    expect(r.text).toBe("build 通った");
    expect(r.axes.length).toBe(0);
  });

  test("--by repo + --text", () => {
    const r = parseBroadcastArgs(["--by", "repo", "--text", "done"]);
    expect(r.axes.length).toBe(1);
    expect(r.text).toBe("done");
  });

  test("--all + --text", () => {
    const r = parseBroadcastArgs(["--all", "--text", "全員 stop"]);
    expect(r.all).toBe(true);
    expect(r.text).toBe("全員 stop");
  });

  test("--text=<msg>", () => {
    const r = parseBroadcastArgs(["--text=hello"]);
    expect(r.text).toBe("hello");
  });

  test("--help はヘルプフラグを立てる", () => {
    const r = parseBroadcastArgs(["--help"]);
    expect(r.help).toBe(true);
  });

  test("positional 本文は usage error (DR-0014)", () => {
    expect(() => parseBroadcastArgs(["build 通った"])).toThrow(UsageError);
  });

  test("positional 本文 with axes も usage error", () => {
    expect(() => parseBroadcastArgs(["--by", "repo", "done"])).toThrow(UsageError);
  });

  test("未知の short フラグ (-m) は UsageError", () => {
    expect(() => parseBroadcastArgs(["-m"])).toThrow(UsageError);
  });

  test("未知の long フラグ (--type=...) は UsageError", () => {
    expect(() => parseBroadcastArgs(["--type=x"])).toThrow(UsageError);
  });

  test("--text の値欠落は UsageError", () => {
    expect(() => parseBroadcastArgs(["--text"])).toThrow(UsageError);
  });
});
