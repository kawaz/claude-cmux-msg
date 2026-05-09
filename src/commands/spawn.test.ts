import { describe, test, expect } from "bun:test";
import { parseSpawnArgs, findRemoteUrl } from "./spawn";
import { UsageError } from "../lib/errors";

describe("parseSpawnArgs", () => {
  test("引数なしはヘルプモード (副作用なし)", () => {
    const r = parseSpawnArgs([]);
    expect(r.help).toBe(true);
  });

  test("--help はヘルプモード", () => {
    const r = parseSpawnArgs(["--help"]);
    expect(r.help).toBe(true);
  });

  test("--help が他の引数より優先される", () => {
    // 旧実装では --help が name に消費される問題への回帰テスト
    const r = parseSpawnArgs(["worker", "--help"]);
    expect(r.help).toBe(true);
  });

  test("ショートオプション (-h 等) は提供しない: 不明フラグとしてエラー", () => {
    expect(() => parseSpawnArgs(["-h"])).toThrow(UsageError);
  });

  test("位置引数 1 つは name", () => {
    const r = parseSpawnArgs(["worker"]);
    expect(r.help).toBe(false);
    expect(r.name).toBe("worker");
  });

  test("--name <v>", () => {
    const r = parseSpawnArgs(["--name", "foo"]);
    expect(r.name).toBe("foo");
  });

  test("--name=<v>", () => {
    const r = parseSpawnArgs(["--name=foo"]);
    expect(r.name).toBe("foo");
  });

  test("--cwd <path>", () => {
    const r = parseSpawnArgs(["worker", "--cwd", "/tmp"]);
    expect(r.name).toBe("worker");
    expect(r.cwd).toBe("/tmp");
  });

  test("--cwd=<path>", () => {
    const r = parseSpawnArgs(["worker", "--cwd=/tmp"]);
    expect(r.cwd).toBe("/tmp");
  });

  test("--args <v>", () => {
    const r = parseSpawnArgs(["worker", "--args", "--debug"]);
    expect(r.claudeArgs).toBe("--debug");
  });

  test("--args=<v>", () => {
    const r = parseSpawnArgs(["worker", "--args=--debug"]);
    expect(r.claudeArgs).toBe("--debug");
  });

  test("デフォルトの claudeArgs は --dangerously-skip-permissions", () => {
    const r = parseSpawnArgs(["worker"]);
    expect(r.claudeArgs).toBe("--dangerously-skip-permissions");
  });

  test("不明なフラグはエラー (-で始まるものは name に誤消費しない)", () => {
    expect(() => parseSpawnArgs(["--foo"])).toThrow(UsageError);
    expect(() => parseSpawnArgs(["--foo=bar"])).toThrow(UsageError);
    expect(() => parseSpawnArgs(["-x"])).toThrow(UsageError);
  });

  test("位置引数が複数あるとエラー", () => {
    expect(() => parseSpawnArgs(["a", "b"])).toThrow(UsageError);
  });

  test("--name と位置引数の併用はエラー", () => {
    expect(() => parseSpawnArgs(["worker", "--name", "other"])).toThrow(
      UsageError
    );
  });

  test("--name の値欠落はエラー", () => {
    expect(() => parseSpawnArgs(["--name"])).toThrow(UsageError);
  });

  test("--cwd と --args の値欠落はエラー", () => {
    expect(() => parseSpawnArgs(["--cwd"])).toThrow(UsageError);
    expect(() => parseSpawnArgs(["--args"])).toThrow(UsageError);
  });

  test("--cwd / --args は位置引数より前でも後でも OK", () => {
    const a = parseSpawnArgs(["--cwd", "/tmp", "worker"]);
    expect(a.name).toBe("worker");
    expect(a.cwd).toBe("/tmp");

    const b = parseSpawnArgs(["worker", "--cwd", "/tmp"]);
    expect(b.name).toBe("worker");
    expect(b.cwd).toBe("/tmp");
  });

  test("--json で構造化出力モード", () => {
    const r = parseSpawnArgs(["worker", "--json"]);
    expect(r.json).toBe(true);
  });

  test("--json なしはデフォルト false", () => {
    const r = parseSpawnArgs(["worker"]);
    expect(r.json).toBe(false);
  });
});

describe("findRemoteUrl", () => {
  test("Claude Code 形式の URL を抽出", () => {
    const screen =
      "Claude Code v2.0.1\n" +
      "Code in CLI or at https://claude.ai/code/session_01NYPVnDQNwS4JxBmMqHkjVH\n" +
      "...";
    expect(findRemoteUrl(screen)).toBe(
      "https://claude.ai/code/session_01NYPVnDQNwS4JxBmMqHkjVH"
    );
  });

  test("URL が無ければ undefined", () => {
    expect(findRemoteUrl("hello world")).toBeUndefined();
  });

  test("session_ プレフィックス必須", () => {
    expect(findRemoteUrl("https://claude.ai/code/foo")).toBeUndefined();
  });

  test("複数行の中から最初の URL を取得", () => {
    const screen =
      "https://claude.ai/code/session_first\n" +
      "https://claude.ai/code/session_second";
    expect(findRemoteUrl(screen)).toBe(
      "https://claude.ai/code/session_first"
    );
  });
});
