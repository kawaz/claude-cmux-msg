import { describe, test, expect } from "bun:test";
import {
  collectDescendantPids,
  isSubscribeCommand,
  detectSubscribeInTree,
  decideSubscribeMessage,
  type ProcNode,
} from "./subscribe-watch";

// ----------------------------------------------------------------------------
// collectDescendantPids: pid/ppid リストから rootPid の子孫 pid 集合を求める純粋関数
// ----------------------------------------------------------------------------

describe("collectDescendantPids", () => {
  function node(pid: number, ppid: number): ProcNode {
    return { pid, ppid };
  }

  test("子・孫を再帰的に集める", () => {
    const procs = [
      node(100, 1), // root claude
      node(200, 100), // 子: shell
      node(300, 200), // 孫: subscribe
      node(400, 1), // 無関係
    ];
    const set = collectDescendantPids(procs, 100);
    expect([...set].sort((a, b) => a - b)).toEqual([200, 300]);
  });

  test("root 自身は含めない", () => {
    const procs = [node(100, 1), node(200, 100)];
    const set = collectDescendantPids(procs, 100);
    expect(set.has(100)).toBe(false);
  });

  test("子孫がいなければ空集合", () => {
    const procs = [node(100, 1), node(400, 1)];
    expect(collectDescendantPids(procs, 100).size).toBe(0);
  });

  test("ppid の循環があっても無限ループしない", () => {
    // 異常データ: 100→200→100 の循環
    const procs = [node(100, 200), node(200, 100)];
    const set = collectDescendantPids(procs, 100);
    // 100 を root にすると 200 を拾うが、200 の子に 100 が居ても再追加しない
    expect(set.has(200)).toBe(true);
    expect(set.has(100)).toBe(false);
  });

  test("複数階層の分岐ツリーを全て辿る", () => {
    const procs = [
      node(10, 1),
      node(20, 10),
      node(21, 10),
      node(30, 20),
      node(31, 21),
    ];
    const set = collectDescendantPids(procs, 10);
    expect([...set].sort((a, b) => a - b)).toEqual([20, 21, 30, 31]);
  });
});

// ----------------------------------------------------------------------------
// isSubscribeCommand: ps の command 表示文字列が cmux-msg subscribe か判定する
// ----------------------------------------------------------------------------

describe("isSubscribeCommand", () => {
  test("コンパイル済みバイナリ cmux-msg subscribe をマッチ", () => {
    const cmd =
      "/Users/kawaz/.claude/plugins/cache/cmux-msg/bin/cmux-msg subscribe";
    expect(isSubscribeCommand(cmd)).toBe(true);
  });

  test("bun 経由 (cli.ts subscribe) もマッチ", () => {
    const cmd =
      "bun /Users/kawaz/.claude/plugins/cache/cmux-msg/src/cli.ts subscribe";
    expect(isSubscribeCommand(cmd)).toBe(true);
  });

  test("subscribe にオプションが付いてもマッチ", () => {
    const cmd = "/path/to/cmux-msg subscribe --since 0";
    expect(isSubscribeCommand(cmd)).toBe(true);
  });

  test("cmux-msg の別サブコマンドはマッチしない", () => {
    expect(isSubscribeCommand("/path/cmux-msg peers --all")).toBe(false);
  });

  test("subscribe を含むが cmux-msg でないコマンドはマッチしない", () => {
    expect(isSubscribeCommand("/usr/bin/git subscribe-thing")).toBe(false);
  });

  test("subscribe という単語が引数値に出るだけではマッチしない", () => {
    expect(isSubscribeCommand("/path/cmux-msg send sid subscribe")).toBe(false);
  });

  test("空文字はマッチしない", () => {
    expect(isSubscribeCommand("")).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// detectSubscribeInTree: root claude pid の子孫ツリーに subscribe が居るか
// ----------------------------------------------------------------------------

describe("detectSubscribeInTree", () => {
  function row(pid: number, ppid: number, command: string) {
    return { pid, ppid, command };
  }

  test("子孫ツリーに subscribe が居れば true", () => {
    const rows = [
      row(100, 1, "claude --session-id x"),
      row(200, 100, "/bin/zsh -i"),
      row(300, 200, "/path/cmux-msg subscribe"),
    ];
    expect(detectSubscribeInTree(rows, 100)).toBe(true);
  });

  test("subscribe が子孫ツリー外なら false", () => {
    const rows = [
      row(100, 1, "claude --session-id x"),
      row(999, 1, "/path/cmux-msg subscribe"), // 別ツリー
    ];
    expect(detectSubscribeInTree(rows, 100)).toBe(false);
  });

  test("子孫はいるが subscribe でなければ false", () => {
    const rows = [
      row(100, 1, "claude"),
      row(200, 100, "/bin/zsh"),
    ];
    expect(detectSubscribeInTree(rows, 100)).toBe(false);
  });

  test("root 直下の子が subscribe でもマッチ", () => {
    const rows = [
      row(100, 1, "claude"),
      row(200, 100, "/path/cmux-msg subscribe"),
    ];
    expect(detectSubscribeInTree(rows, 100)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// decideSubscribeMessage: source × 実検出 → 文言の決定 (DR-0007 決定10)
// ----------------------------------------------------------------------------

describe("decideSubscribeMessage", () => {
  test("startup + 未検出 → 起動案内 (variant=start)", () => {
    expect(decideSubscribeMessage("startup", false).variant).toBe("start");
  });

  test("resume + 未検出 → 警告で張り直し (variant=restart)", () => {
    expect(decideSubscribeMessage("resume", false).variant).toBe("restart");
  });

  test("clear + 検出済み → 再起動不要 (variant=running)", () => {
    expect(decideSubscribeMessage("clear", true).variant).toBe("running");
  });

  test("compact + 検出済み → 再起動不要 (variant=running)", () => {
    expect(decideSubscribeMessage("compact", true).variant).toBe("running");
  });

  test("実検出を source より優先: resume だが検出済みなら running", () => {
    // resume で死んでいるはずだが実際に生きている → 誤検知回避で running
    expect(decideSubscribeMessage("resume", true).variant).toBe("running");
  });

  test("実検出を source より優先: clear だが未検出なら restart", () => {
    // clear で生きているはずだが死んでいる → 実検出優先で張り直し
    expect(decideSubscribeMessage("clear", false).variant).toBe("restart");
  });

  test("startup + 検出済み (異例) → running", () => {
    expect(decideSubscribeMessage("startup", true).variant).toBe("running");
  });

  test("未知の source + 未検出 → restart (安全側、張り直し促す)", () => {
    expect(decideSubscribeMessage("unknown-xyz", false).variant).toBe(
      "restart"
    );
  });

  test("検出済みなら source 不問で running", () => {
    expect(decideSubscribeMessage("unknown-xyz", true).variant).toBe("running");
  });

  test("文言には何らかの案内テキストが含まれる", () => {
    expect(decideSubscribeMessage("startup", false).text.length).toBeGreaterThan(
      0
    );
    expect(decideSubscribeMessage("resume", false).text).toContain("subscribe");
    expect(decideSubscribeMessage("clear", true).text).toContain("subscribe");
  });
});
