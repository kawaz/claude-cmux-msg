import { describe, test, expect } from "bun:test";
import {
  parseRunState,
  parsePsOutput,
  commandMatchesSid,
  resolveSidFromPsRows,
  type PsRow,
} from "./session-proc";

// ----------------------------------------------------------------------------
// フィクスチャ: findings/2026-05-18-session-identity-evidence.md の実 argv 形に倣う。
// 正規 claude argv: `claude --settings {JSON} --session-id <uuid> --dangerously-skip-permissions`
// ----------------------------------------------------------------------------

const SID_A = "8902751f-3b30-48c3-9cbf-69e6f257c64a";
const SID_B = "5e30f97f-f6aa-4231-baa0-279a6853a962";

/** ps -axww -o pid,ppid,pgid,tpgid,stat,tty,lstart,command の 1 行を組み立てる。 */
function psLine(opts: {
  pid: number;
  ppid?: number;
  pgid: number;
  tpgid: number;
  stat: string;
  tty: string;
  command: string;
}): string {
  const ppid = opts.ppid ?? 1;
  // lstart は固定 5 トークン (LC_ALL=C 英語表記)
  const lstart = "Sun May 18 10:48:47 2026";
  return [
    String(opts.pid),
    String(ppid),
    String(opts.pgid),
    String(opts.tpgid),
    opts.stat,
    opts.tty,
    lstart,
    opts.command,
  ].join(" ");
}

const PS_HEADER =
  "  PID  PPID  PGID TPGID STAT TTY      STARTED                      COMMAND";

describe("parseRunState", () => {
  test("S は running", () => {
    expect(parseRunState("S")).toBe("running");
  });
  test("S+ (foreground) は running", () => {
    expect(parseRunState("S+")).toBe("running");
  });
  test("Ss+ は running", () => {
    expect(parseRunState("Ss+")).toBe("running");
  });
  test("R+ は running", () => {
    expect(parseRunState("R+")).toBe("running");
  });
  test("T (Ctrl-Z 等で停止) は suspended", () => {
    expect(parseRunState("T")).toBe("suspended");
  });
  test("T+ (修飾フラグ付き stopped) も suspended", () => {
    expect(parseRunState("T+")).toBe("suspended");
  });
  test("1 文字目以外に T があっても suspended", () => {
    expect(parseRunState("ST")).toBe("suspended");
  });
  test("1 文字目 Z は zombie", () => {
    expect(parseRunState("Z")).toBe("zombie");
  });
  test("1 文字目 U は unresponsive", () => {
    expect(parseRunState("U")).toBe("unresponsive");
  });
  test("1 文字目 D は unresponsive (uninterruptible sleep)", () => {
    expect(parseRunState("D")).toBe("unresponsive");
  });
  test("前後の空白は無視する", () => {
    expect(parseRunState("  S+  ")).toBe("running");
  });
});

describe("commandMatchesSid", () => {
  test("正規 argv (--session-id 直後が対象 UUID) はマッチ", () => {
    const cmd = `claude --settings {"foo":1} --session-id ${SID_A} --dangerously-skip-permissions`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(true);
  });

  test("フルパスの claude でも basename が claude ならマッチ", () => {
    const cmd = `/Users/kawaz/.claude/bin/claude --session-id ${SID_A}`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(true);
  });

  test("--resume 直後が対象 UUID でもマッチ", () => {
    const cmd = `claude --resume ${SID_A} --dangerously-skip-permissions`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(true);
  });

  test("別 UUID の claude はマッチしない", () => {
    const cmd = `claude --session-id ${SID_B} --dangerously-skip-permissions`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(false);
  });

  test("argv[0] が claude でない (subscribe 等) はマッチしない", () => {
    const cmd = `/Users/kawaz/.../bin/cmux-msg subscribe --session-id ${SID_A}`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(false);
  });

  test("argv[0] が zsh のラッパー行 (env に UUID 文字列を含む) でもマッチしない", () => {
    const cmd = `/bin/zsh -c export CMUXMSG_SESSION_ID=${SID_A} && eval foo`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(false);
  });

  test("--session-id の値が UUID でない (末尾トークン) はマッチしない", () => {
    const cmd = `claude --session-id`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(false);
  });

  test("UUID は大文字小文字を無視して照合する", () => {
    const cmd = `claude --session-id ${SID_A.toUpperCase()}`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(true);
  });

  test("claude を含むが basename が違う (claude-code 等) はマッチしない", () => {
    const cmd = `claude-code --session-id ${SID_A}`;
    expect(commandMatchesSid(cmd, SID_A)).toBe(false);
  });

  test("空文字はマッチしない", () => {
    expect(commandMatchesSid("", SID_A)).toBe(false);
  });
});

describe("parsePsOutput", () => {
  test("ヘッダ行はスキップする", () => {
    const raw = [
      PS_HEADER,
      psLine({
        pid: 100,
        pgid: 100,
        tpgid: 100,
        stat: "S+",
        tty: "ttys008",
        command: `claude --session-id ${SID_A}`,
      }),
    ].join("\n");
    const rows = parsePsOutput(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pid).toBe(100);
  });

  test("各列を正しく構造化する", () => {
    const raw = [
      PS_HEADER,
      psLine({
        pid: 24792,
        ppid: 24700,
        pgid: 24792,
        tpgid: 24792,
        stat: "S+",
        tty: "ttys008",
        command: `claude --settings {"hooks":{}} --session-id ${SID_A} --dangerously-skip-permissions`,
      }),
    ].join("\n");
    const rows = parsePsOutput(raw);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.pid).toBe(24792);
    expect(r.ppid).toBe(24700);
    expect(r.pgid).toBe(24792);
    expect(r.tpgid).toBe(24792);
    expect(r.stat).toBe("S+");
    expect(r.tty).toBe("ttys008");
    expect(r.startTime).toBe("Sun May 18 10:48:47 2026");
    expect(r.command).toBe(
      `claude --settings {"hooks":{}} --session-id ${SID_A} --dangerously-skip-permissions`
    );
  });

  test("command 内の連続空白を潰さない", () => {
    const raw = psLine({
      pid: 1,
      pgid: 1,
      tpgid: 1,
      stat: "S",
      tty: "??",
      command: `claude  --session-id   ${SID_A}`,
    });
    const rows = parsePsOutput(raw);
    expect(rows[0]!.command).toBe(`claude  --session-id   ${SID_A}`);
  });

  test("tty が ?? の行も取り込める", () => {
    const raw = psLine({
      pid: 14364,
      pgid: 57208,
      tpgid: 0,
      stat: "S",
      tty: "??",
      command: "/some/native-binary/claude --output-format stream-json",
    });
    const rows = parsePsOutput(raw);
    expect(rows[0]!.tty).toBe("??");
    expect(rows[0]!.tpgid).toBe(0);
  });

  test("空行は無視する", () => {
    const raw = [
      "",
      psLine({
        pid: 100,
        pgid: 100,
        tpgid: 100,
        stat: "S+",
        tty: "ttys000",
        command: "claude",
      }),
      "",
    ].join("\n");
    expect(parsePsOutput(raw)).toHaveLength(1);
  });

  test("トークン数が足りない行はスキップする", () => {
    const raw = "100 200 300";
    expect(parsePsOutput(raw)).toHaveLength(0);
  });
});

describe("resolveSidFromPsRows", () => {
  function row(over: Partial<PsRow>): PsRow {
    return {
      pid: 100,
      ppid: 1,
      pgid: 100,
      tpgid: 100,
      stat: "S+",
      tty: "ttys008",
      startTime: "Sun May 18 10:48:47 2026",
      command: `claude --session-id ${SID_A}`,
      ...over,
    };
  }

  test("ヒット 0 件は not_found", () => {
    const rows = [row({ command: `claude --session-id ${SID_B}` })];
    expect(resolveSidFromPsRows(rows, SID_A)).toEqual({ kind: "not_found" });
  });

  test("ヒット 1 件は found (フィールド正規化)", () => {
    const rows = [row({})];
    const r = resolveSidFromPsRows(rows, SID_A);
    expect(r).toEqual({
      kind: "found",
      pid: 100,
      tty: "ttys008",
      pgid: 100,
      tpgid: 100,
      startTime: "Sun May 18 10:48:47 2026",
      isForeground: true,
      runState: "running",
    });
  });

  test("found: pgid != tpgid なら isForeground=false (background)", () => {
    const rows = [row({ pgid: 100, tpgid: 999 })];
    const r = resolveSidFromPsRows(rows, SID_A);
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.isForeground).toBe(false);
  });

  test("found: stat T は runState=suspended", () => {
    const rows = [row({ stat: "T" })];
    const r = resolveSidFromPsRows(rows, SID_A);
    if (r.kind === "found") expect(r.runState).toBe("suspended");
    else throw new Error("expected found");
  });

  test("found: 生 stat 文字列はリーク不可 (フィールドに stat が無い)", () => {
    const rows = [row({ stat: "Ss+" })];
    const r = resolveSidFromPsRows(rows, SID_A);
    expect(JSON.stringify(r)).not.toContain("Ss+");
  });

  test("ヒット 2 件以上は ambiguous (pid + startTime 併記)", () => {
    const rows = [
      row({ pid: 100, startTime: "Sun May 18 10:00:00 2026" }),
      row({ pid: 200, startTime: "Sun May 18 11:00:00 2026" }),
    ];
    const r = resolveSidFromPsRows(rows, SID_A);
    expect(r).toEqual({
      kind: "ambiguous",
      procs: [
        { pid: 100, startTime: "Sun May 18 10:00:00 2026" },
        { pid: 200, startTime: "Sun May 18 11:00:00 2026" },
      ],
    });
  });

  test("subscribe プロセス (basename が claude でない) は誤ヒットしない", () => {
    const rows = [
      row({
        pid: 14898,
        command: `/Users/kawaz/.../bin/cmux-msg subscribe --session-id ${SID_A}`,
      }),
      row({ pid: 24792 }),
    ];
    const r = resolveSidFromPsRows(rows, SID_A);
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.pid).toBe(24792);
  });
});

describe("parsePsOutput + resolveSidFromPsRows (結合)", () => {
  test("複数 claude が並ぶ実出力から対象 sid を 1 件引く", () => {
    const raw = [
      PS_HEADER,
      psLine({
        pid: 24792,
        pgid: 24792,
        tpgid: 24792,
        stat: "S+",
        tty: "ttys008",
        command: `claude --settings {"a":1} --session-id ${SID_A} --dangerously-skip-permissions`,
      }),
      psLine({
        pid: 14897,
        pgid: 14897,
        tpgid: 14897,
        stat: "S+",
        tty: "ttys000",
        command: `claude --settings {"a":1} --session-id ${SID_B} --dangerously-skip-permissions`,
      }),
      psLine({
        pid: 14898,
        pgid: 14897,
        tpgid: 14897,
        stat: "S",
        tty: "??",
        command:
          "/Users/kawaz/.claude/plugins/cache/cmux-msg/bin/cmux-msg subscribe",
      }),
    ].join("\n");
    const rows = parsePsOutput(raw);
    const r = resolveSidFromPsRows(rows, SID_A);
    expect(r.kind).toBe("found");
    if (r.kind === "found") {
      expect(r.pid).toBe(24792);
      expect(r.tty).toBe("ttys008");
      expect(r.isForeground).toBe(true);
      expect(r.runState).toBe("running");
    }
  });
});
