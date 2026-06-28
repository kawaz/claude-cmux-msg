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
    cwd: "/repo/foo",
    repo_root: "/repo",
    tags: [],
    state: "idle" as SessionState,
    state_changed_at: "2026-05-12T00:00:00+09:00",
    init_at: "2026-05-12T00:00:00+09:00",
    last_started_at: "2026-05-12T00:00:00+09:00",
    last_observed_pid: { pid: 1234, start_time: "Sun May 18 10:00:00 2026" },
    ...overrides,
  };
}

describe("parseByAxis", () => {
  test("plain 軸", () => {
    expect(parseByAxis("home")).toEqual({ kind: "home" });
    expect(parseByAxis("cwd")).toEqual({ kind: "cwd" });
    expect(parseByAxis("repo")).toEqual({ kind: "repo" });
  });

  test("tag:<name>", () => {
    expect(parseByAxis("tag:hot")).toEqual({ kind: "tag", name: "hot" });
  });

  test("tag: の name が空はエラー", () => {
    expect(() => parseByAxis("tag:")).toThrow(/name が空/);
  });

  test("cwd:<pattern> (substring grep モード)", () => {
    expect(parseByAxis("cwd:hyoui")).toEqual({ kind: "cwd", pattern: "hyoui" });
    expect(parseByAxis("cwd:cmux-msg")).toEqual({ kind: "cwd", pattern: "cmux-msg" });
  });

  test("repo:<pattern> (substring grep モード)", () => {
    expect(parseByAxis("repo:bump")).toEqual({ kind: "repo", pattern: "bump" });
  });

  test("cwd: / repo: の pattern が空はエラー", () => {
    expect(() => parseByAxis("cwd:")).toThrow(/pattern が空/);
    expect(() => parseByAxis("repo:")).toThrow(/pattern が空/);
  });

  test("不明な軸はエラー", () => {
    expect(() => parseByAxis("nope")).toThrow(/不明な軸/);
  });
});

describe("extractByArgs", () => {
  test("--by を分離", () => {
    const r = extractByArgs(["--by", "home", "msg"]);
    expect(r.axes).toEqual([{ kind: "home" }]);
    expect(r.all).toBe(false);
    expect(r.rest).toEqual(["msg"]);
  });

  test("--by=axis 形式", () => {
    const r = extractByArgs(["--by=cwd"]);
    expect(r.axes).toEqual([{ kind: "cwd" }]);
  });

  test("複数 --by は配列で積まれる", () => {
    const r = extractByArgs(["--by", "home", "--by", "repo", "body"]);
    expect(r.axes).toEqual([{ kind: "home" }, { kind: "repo" }]);
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
    cwd: "/repo/foo",
    repo_root: "/repo",
    tags: ["alpha", "beta"],
  });

  test("home 一致", () => {
    expect(matchAxis(me, meta({ claude_home: "/home/u/.claude" }), { kind: "home" })).toBe(true);
    expect(matchAxis(me, meta({ claude_home: "/other/.claude" }), { kind: "home" })).toBe(false);
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

  test("旧 meta.json (tags フィールド不在) でも tag 軸でクラッシュしない", () => {
    // 旧 schema を擬似的に作る (= tags プロパティを undefined に倒す)
    const oldPeer = { ...meta(), tags: undefined as unknown as string[] };
    expect(matchAxis(me, oldPeer, { kind: "tag", name: "anything" })).toBe(false);
  });

  test("cwd:<pattern> は peer.cwd に pattern を含む時のみ true (自分基準ではない)", () => {
    // 自分の cwd は /repo/foo だが、pattern は peer 側を見る
    expect(matchAxis(me, meta({ cwd: "/repo/foo/sub" }), { kind: "cwd", pattern: "foo" })).toBe(true);
    expect(matchAxis(me, meta({ cwd: "/other/path" }), { kind: "cwd", pattern: "foo" })).toBe(false);
    // prefix 違いも substring で吸収
    expect(matchAxis(me, meta({ cwd: "/x/claude-cmux-msg/main" }), { kind: "cwd", pattern: "cmux-msg" })).toBe(true);
  });

  test("repo:<pattern> は peer.repo_root に pattern を含む時のみ true (両方 repo_root 不要)", () => {
    expect(matchAxis(me, meta({ repo_root: "/x/hyoui" }), { kind: "repo", pattern: "hyoui" })).toBe(true);
    expect(matchAxis(me, meta({ repo_root: "/x/other" }), { kind: "repo", pattern: "hyoui" })).toBe(false);
    // peer に repo_root が無ければ false (自分側の repo_root 不問)
    expect(matchAxis(me, meta({ repo_root: undefined }), { kind: "repo", pattern: "hyoui" })).toBe(false);
    // 自分に repo_root が無くても peer に pattern が当たれば true (substring モード時)
    const meNoRepo = meta({ repo_root: undefined });
    expect(matchAxis(meNoRepo, meta({ repo_root: "/x/hyoui" }), { kind: "repo", pattern: "hyoui" })).toBe(true);
  });

  test("matchAllAxes: 全 axis 一致のみ true (AND)", () => {
    const peer = meta({
      claude_home: "/home/u/.claude",
      tags: ["alpha"],
    });
    expect(matchAllAxes(me, peer, [{ kind: "home" }, { kind: "tag", name: "alpha" }])).toBe(true);
    expect(matchAllAxes(me, peer, [{ kind: "home" }, { kind: "tag", name: "missing" }])).toBe(false);
  });

  test("matchAllAxes: 空配列は常に true (no-op filter)", () => {
    expect(matchAllAxes(me, meta(), [])).toBe(true);
  });
});

describe("describeAxis", () => {
  test("各軸を文字列化", () => {
    expect(describeAxis({ kind: "home" })).toBe("home");
    expect(describeAxis({ kind: "tag", name: "x" })).toBe("tag:x");
    expect(describeAxis({ kind: "cwd" })).toBe("cwd");
    expect(describeAxis({ kind: "cwd", pattern: "foo" })).toBe("cwd:foo");
    expect(describeAxis({ kind: "repo" })).toBe("repo");
    expect(describeAxis({ kind: "repo", pattern: "bar" })).toBe("repo:bar");
  });
});
