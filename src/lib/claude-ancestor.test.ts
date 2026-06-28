import { describe, test, expect } from "bun:test";
import { isClaudeCommand, findClaudeAncestor } from "./claude-ancestor";

describe("isClaudeCommand", () => {
  test("argv[0] の basename が claude", () => {
    expect(isClaudeCommand("/usr/local/bin/claude")).toBe(true);
    expect(isClaudeCommand("claude")).toBe(true);
    expect(isClaudeCommand("/usr/local/bin/claude prompt")).toBe(true);
    expect(isClaudeCommand("/usr/local/bin/claude --session-id abc")).toBe(true);
  });

  test("claude を含むだけのパスは false", () => {
    expect(isClaudeCommand("/path/claude-helper")).toBe(false);
    expect(isClaudeCommand("/path/notclaude")).toBe(false);
    expect(isClaudeCommand("not-claude --foo")).toBe(false);
  });

  test("空文字 / 空白のみは false", () => {
    expect(isClaudeCommand("")).toBe(false);
    expect(isClaudeCommand("   ")).toBe(false);
  });
});

describe("findClaudeAncestor", () => {
  test("親が claude なら直接ヒット", () => {
    const rows = [
      { pid: 100, ppid: 50, command: "bun /path/cli.ts subscribe" },
      { pid: 50, ppid: 1, command: "/usr/local/bin/claude" },
    ];
    expect(findClaudeAncestor(rows, 100)).toBe(50);
  });

  test("祖父が claude (= 中間に shell が挟まる)", () => {
    const rows = [
      { pid: 200, ppid: 150, command: "bun src/hooks/session-start.ts" },
      { pid: 150, ppid: 100, command: "/bin/bash -c 'bun ...'" },
      { pid: 100, ppid: 1, command: "claude" },
    ];
    expect(findClaudeAncestor(rows, 200)).toBe(100);
  });

  test("チェーンに claude が無ければ null", () => {
    const rows = [
      { pid: 100, ppid: 50, command: "bun cli.ts" },
      { pid: 50, ppid: 1, command: "tmux" },
    ];
    expect(findClaudeAncestor(rows, 100)).toBeNull();
  });

  test("startPid が rows に無ければ null", () => {
    const rows = [{ pid: 100, ppid: 50, command: "claude" }];
    expect(findClaudeAncestor(rows, 999)).toBeNull();
  });

  test("PID 1 に到達したら打ち切り", () => {
    const rows = [
      { pid: 100, ppid: 1, command: "tmux" },
      { pid: 1, ppid: 0, command: "/sbin/init" },
    ];
    expect(findClaudeAncestor(rows, 100)).toBeNull();
  });

  test("循環は seen 集合で打ち切り", () => {
    const rows = [
      { pid: 100, ppid: 200, command: "a" },
      { pid: 200, ppid: 100, command: "b" }, // 循環
    ];
    expect(findClaudeAncestor(rows, 100)).toBeNull();
  });

  test("maxDepth 超過で null", () => {
    const rows: { pid: number; ppid: number; command: string }[] = [];
    // chain: 100 → 101 → 102 → ... → 119 → 120 (claude)
    for (let i = 100; i < 120; i++) {
      rows.push({ pid: i, ppid: i + 1, command: "noise" });
    }
    rows.push({ pid: 120, ppid: 50, command: "claude" });
    rows.push({ pid: 50, ppid: 1, command: "/sbin/init" });
    // maxDepth=5 だと 120 にたどり着かない (100 から 105 まで)
    expect(findClaudeAncestor(rows, 100, 5)).toBeNull();
    // maxDepth=25 ならヒット
    expect(findClaudeAncestor(rows, 100, 25)).toBe(120);
  });

  test("自分自身が claude なら自分の pid を返す", () => {
    const rows = [{ pid: 100, ppid: 50, command: "claude" }];
    expect(findClaudeAncestor(rows, 100)).toBe(100);
  });
});
