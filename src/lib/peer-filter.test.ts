import { describe, test, expect } from "bun:test";
import {
  parseByAxis,
  extractByArgs,
  matchAxis,
  matchAllAxes,
  describeAxis,
} from "./peer-filter";
import type { PeerMeta, SessionState } from "../types";

function meta(overrides: Partial<PeerMeta> = {}): PeerMeta {
  return {
    session_id: "11111111-1111-1111-1111-111111111111",
    claude_home: "/home/user/.claude",
    workspace_id: "WS1",
    cwd: "/repo/foo",
    repo_root: "/repo",
    tags: [],
    state: "idle" as SessionState,
    state_changed_at: "2026-05-12T00:00:00+09:00",
    init_at: "2026-05-12T00:00:00+09:00",
    last_started_at: "2026-05-12T00:00:00+09:00",
    claude_pid: 1234,
    ...overrides,
  };
}

describe("parseByAxis", () => {
  test("plain 軸", () => {
    expect(parseByAxis("home")).toEqual({ kind: "home" });
    expect(parseByAxis("ws")).toEqual({ kind: "ws" });
    expect(parseByAxis("cwd")).toEqual({ kind: "cwd" });
    expect(parseByAxis("repo")).toEqual({ kind: "repo" });
  });

  test("tag:<name>", () => {
    expect(parseByAxis("tag:hot")).toEqual({ kind: "tag", name: "hot" });
  });

  test("tag: の name が空はエラー", () => {
    expect(() => parseByAxis("tag:")).toThrow(/name が空/);
  });

  test("不明な軸はエラー", () => {
    expect(() => parseByAxis("nope")).toThrow(/不明な軸/);
  });
});

describe("extractByArgs", () => {
  test("--by を分離", () => {
    const r = extractByArgs(["--by", "ws", "msg"]);
    expect(r.axes).toEqual([{ kind: "ws" }]);
    expect(r.all).toBe(false);
    expect(r.rest).toEqual(["msg"]);
  });

  test("--by=axis 形式", () => {
    const r = extractByArgs(["--by=cwd"]);
    expect(r.axes).toEqual([{ kind: "cwd" }]);
  });

  test("複数 --by は配列で積まれる", () => {
    const r = extractByArgs(["--by", "home", "--by", "ws", "body"]);
    expect(r.axes).toEqual([{ kind: "home" }, { kind: "ws" }]);
    expect(r.rest).toEqual(["body"]);
  });

  test("--all を分離", () => {
    const r = extractByArgs(["--all", "hello"]);
    expect(r.all).toBe(true);
    expect(r.rest).toEqual(["hello"]);
  });

  test("--by に値が無いとエラー", () => {
    expect(() => extractByArgs(["--by"])).toThrow(/値が必要/);
  });
});

describe("matchAxis / matchAllAxes", () => {
  const me = meta({
    claude_home: "/home/u/.claude",
    workspace_id: "WS_X",
    cwd: "/repo/foo",
    repo_root: "/repo",
    tags: ["alpha", "beta"],
  });

  test("home 一致", () => {
    expect(matchAxis(me, meta({ claude_home: "/home/u/.claude" }), { kind: "home" })).toBe(true);
    expect(matchAxis(me, meta({ claude_home: "/other/.claude" }), { kind: "home" })).toBe(false);
  });

  test("ws 一致", () => {
    expect(matchAxis(me, meta({ workspace_id: "WS_X" }), { kind: "ws" })).toBe(true);
    expect(matchAxis(me, meta({ workspace_id: "WS_Y" }), { kind: "ws" })).toBe(false);
  });

  test("repo 一致は repo_root が両方ある時のみ true", () => {
    expect(matchAxis(me, meta({ repo_root: "/repo" }), { kind: "repo" })).toBe(true);
    expect(matchAxis(me, meta({ repo_root: undefined }), { kind: "repo" })).toBe(false);
    const meNoRepo = meta({ repo_root: undefined });
    expect(matchAxis(meNoRepo, meta({ repo_root: "/repo" }), { kind: "repo" })).toBe(false);
  });

  test("tag は peer の tags に含まれる時のみ true", () => {
    expect(matchAxis(me, meta({ tags: ["alpha"] }), { kind: "tag", name: "alpha" })).toBe(true);
    expect(matchAxis(me, meta({ tags: ["beta"] }), { kind: "tag", name: "alpha" })).toBe(false);
  });

  test("matchAllAxes: 全 axis 一致のみ true (AND)", () => {
    const peer = meta({
      claude_home: "/home/u/.claude",
      workspace_id: "WS_X",
      tags: ["alpha"],
    });
    expect(matchAllAxes(me, peer, [{ kind: "home" }, { kind: "ws" }])).toBe(true);
    expect(matchAllAxes(me, peer, [{ kind: "home" }, { kind: "ws" }, { kind: "tag", name: "missing" }])).toBe(false);
  });

  test("matchAllAxes: 空配列は常に true (no-op filter)", () => {
    expect(matchAllAxes(me, meta(), [])).toBe(true);
  });
});

describe("describeAxis", () => {
  test("各軸を文字列化", () => {
    expect(describeAxis({ kind: "home" })).toBe("home");
    expect(describeAxis({ kind: "tag", name: "x" })).toBe("tag:x");
  });
});
