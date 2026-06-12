import { describe, expect, test } from "bun:test";
import { parseBroadcastArgs } from "./broadcast";
import { UsageError } from "../lib/errors";

describe("parseBroadcastArgs", () => {
  test("軸なし本文のみ", () => {
    const r = parseBroadcastArgs(["build 通った"]);
    expect(r.help).toBe(false);
    expect(r.all).toBe(false);
    expect(r.axes.length).toBe(0);
    expect(r.body).toBe("build 通った");
  });

  test("--by repo + 本文", () => {
    const r = parseBroadcastArgs(["--by", "repo", "done"]);
    expect(r.axes.length).toBe(1);
    expect(r.body).toBe("done");
  });

  test("--all + 本文", () => {
    const r = parseBroadcastArgs(["--all", "全員 stop"]);
    expect(r.all).toBe(true);
    expect(r.body).toBe("全員 stop");
  });

  test("--help はヘルプフラグを立てる", () => {
    const r = parseBroadcastArgs(["--help"]);
    expect(r.help).toBe(true);
  });

  test("-- セパレータ以降の --help は本文として扱う", () => {
    const r = parseBroadcastArgs(["--", "--help"]);
    expect(r.help).toBe(false);
    expect(r.body).toBe("--help");
  });

  test("未知の short フラグ (-m) は UsageError", () => {
    expect(() => parseBroadcastArgs(["-m", "本文"])).toThrow(UsageError);
  });

  test("未知の long フラグ (--type=...) は UsageError", () => {
    expect(() => parseBroadcastArgs(["--type=x", "本文"])).toThrow(UsageError);
  });

  test("-- セパレータ以降は - 始まりでも本文として扱う", () => {
    const r = parseBroadcastArgs(["--", "-m", "本文"]);
    expect(r.body).toBe("-m 本文");
  });

  test("-- セパレータ前の --by は通常通り解釈される", () => {
    const r = parseBroadcastArgs(["--by", "repo", "--", "--こんにちは"]);
    expect(r.axes.length).toBe(1);
    expect(r.body).toBe("--こんにちは");
  });

  test("本文が空なら body は空文字", () => {
    const r = parseBroadcastArgs(["--all"]);
    expect(r.body).toBe("");
  });
});
