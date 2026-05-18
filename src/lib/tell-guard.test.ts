import { describe, test, expect } from "bun:test";
import {
  classifyAmbiguous,
  isSingleLineText,
  evaluateTellGuard,
  evaluateScreenGuard,
  evaluateRecheck,
} from "./tell-guard";
import type {
  SidProcessLookup,
  RunState,
  PidRecheck,
} from "./session-proc";
import type { SurfaceLookup } from "./cmux-surface";

// ----------------------------------------------------------------------------
// フィクスチャ
// ----------------------------------------------------------------------------

function foundProc(overrides?: {
  isForeground?: boolean;
  runState?: RunState;
}): SidProcessLookup {
  return {
    kind: "found",
    pid: 4242,
    tty: "ttys008",
    pgid: 4242,
    tpgid: 4242,
    startTime: "Sun May 18 10:48:47 2026",
    isForeground: overrides?.isForeground ?? true,
    runState: overrides?.runState ?? "running",
  };
}

const FOUND_SURFACE: SurfaceLookup = {
  kind: "found",
  surfaceRef: "surface:35",
};

// ----------------------------------------------------------------------------
// isSingleLineText
// ----------------------------------------------------------------------------

describe("isSingleLineText", () => {
  test("通常のテキストは true", () => {
    expect(isSingleLineText("hello world テスト")).toBe(true);
  });

  test("半角スペースを含むテキストは true", () => {
    expect(isSingleLineText("a b c")).toBe(true);
  });

  test("改行 (\\n) を含むと false", () => {
    expect(isSingleLineText("line1\nline2")).toBe(false);
  });

  test("復帰 (\\r) を含むと false", () => {
    expect(isSingleLineText("line1\rline2")).toBe(false);
  });

  test("タブ (\\t) を含むと false", () => {
    expect(isSingleLineText("a\tb")).toBe(false);
  });

  test("制御文字 (ESC) を含むと false", () => {
    expect(isSingleLineText("a\x1bb")).toBe(false);
  });

  test("DEL (0x7F) を含むと false", () => {
    expect(isSingleLineText("a\x7fb")).toBe(false);
  });

  test("空文字列は true", () => {
    expect(isSingleLineText("")).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// classifyAmbiguous
// ----------------------------------------------------------------------------

describe("classifyAmbiguous", () => {
  test("lstart が異なれば concurrent_resume", () => {
    expect(
      classifyAmbiguous([
        { pid: 1, startTime: "Sun May 18 10:00:00 2026" },
        { pid: 2, startTime: "Sun May 18 11:00:00 2026" },
      ])
    ).toBe("ambiguous_concurrent_resume");
  });

  test("lstart が同一なら unexpected", () => {
    expect(
      classifyAmbiguous([
        { pid: 1, startTime: "Sun May 18 10:00:00 2026" },
        { pid: 2, startTime: "Sun May 18 10:00:00 2026" },
      ])
    ).toBe("ambiguous_unexpected");
  });
});

// ----------------------------------------------------------------------------
// evaluateTellGuard
// ----------------------------------------------------------------------------

describe("evaluateTellGuard", () => {
  const base = {
    proc: foundProc(),
    surface: FOUND_SURFACE,
    metaState: "idle" as string | null,
    crossHome: false,
    ignoreCrossHome: false,
    text: "hello",
  };

  test("全条件を満たせば allow", () => {
    const d = evaluateTellGuard(base);
    expect(d.allow).toBe(true);
    if (d.allow) {
      expect(d.surfaceRef).toBe("surface:35");
      expect(d.pid).toBe(4242);
      expect(d.startTime).toBe("Sun May 18 10:48:47 2026");
    }
  });

  test("改行を含む text は multiline で拒否", () => {
    const d = evaluateTellGuard({ ...base, text: "a\nb" });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("multiline");
  });

  test("proc not_found は not_found で拒否", () => {
    const d = evaluateTellGuard({ ...base, proc: { kind: "not_found" } });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("not_found");
  });

  test("proc check_failed は check_failed で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      proc: { kind: "check_failed", error: "ps timeout" },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe("check_failed");
      expect(d.detail).toContain("ps timeout");
    }
  });

  test("ambiguous (lstart 差あり) は concurrent_resume で拒否し conflicts を返す", () => {
    const procs = [
      { pid: 100, startTime: "Sun May 18 10:00:00 2026" },
      { pid: 200, startTime: "Sun May 18 11:00:00 2026" },
    ];
    const d = evaluateTellGuard({
      ...base,
      proc: { kind: "ambiguous", procs },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe("ambiguous_concurrent_resume");
      expect(d.conflicts).toEqual(procs);
      expect(d.detail).toContain("pid=100");
      expect(d.detail).toContain("pid=200");
    }
  });

  test("ambiguous (lstart 同一) は unexpected で拒否", () => {
    const procs = [
      { pid: 100, startTime: "Sun May 18 10:00:00 2026" },
      { pid: 200, startTime: "Sun May 18 10:00:00 2026" },
    ];
    const d = evaluateTellGuard({
      ...base,
      proc: { kind: "ambiguous", procs },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe("ambiguous_unexpected");
      expect(d.conflicts).toEqual(procs);
    }
  });

  test("suspended プロセスは suspended で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      proc: foundProc({ runState: "suspended" }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("suspended");
  });

  test("zombie プロセスは dead で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      proc: foundProc({ runState: "zombie" }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("dead");
  });

  test("unresponsive プロセスは unresponsive で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      proc: foundProc({ runState: "unresponsive" }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("unresponsive");
  });

  test("background プロセスは background で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      proc: foundProc({ isForeground: false }),
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("background");
  });

  test("surface no_surface は no_cmux_surface で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      surface: { kind: "no_surface" },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("no_cmux_surface");
  });

  test("surface check_failed は check_failed で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      surface: { kind: "check_failed", error: "cmux unreachable" },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("check_failed");
  });

  test("surface ambiguous は no_cmux_surface で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      surface: { kind: "ambiguous", surfaceRefs: ["surface:1", "surface:2"] },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("no_cmux_surface");
  });

  test("state が running なら busy で拒否", () => {
    const d = evaluateTellGuard({ ...base, metaState: "running" });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("busy");
  });

  test("state が awaiting_permission なら busy で拒否 (DR-0007 決定5)", () => {
    const d = evaluateTellGuard({ ...base, metaState: "awaiting_permission" });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("busy");
  });

  test("cross_home かつ ignoreCrossHome=false なら cross_home で拒否", () => {
    const d = evaluateTellGuard({
      ...base,
      crossHome: true,
      metaState: null,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("cross_home");
  });

  test("cross_home かつ ignoreCrossHome=true なら state 不明でも allow", () => {
    const d = evaluateTellGuard({
      ...base,
      crossHome: true,
      ignoreCrossHome: true,
      metaState: null,
    });
    expect(d.allow).toBe(true);
  });

  test("text チェックが proc チェックより先に走る (multiline 優先)", () => {
    const d = evaluateTellGuard({
      ...base,
      proc: { kind: "not_found" },
      text: "a\nb",
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("multiline");
  });
});

// ----------------------------------------------------------------------------
// evaluateRecheck (DR-0007 決定6)
// ----------------------------------------------------------------------------

describe("evaluateRecheck", () => {
  const START = "Sun May 18 10:48:47 2026";

  function foundRecheck(overrides?: {
    isForeground?: boolean;
    runState?: RunState;
    startTime?: string;
  }): PidRecheck {
    return {
      kind: "found",
      pid: 4242,
      tty: "ttys008",
      pgid: 4242,
      tpgid: 4242,
      startTime: overrides?.startTime ?? START,
      isForeground: overrides?.isForeground ?? true,
      runState: overrides?.runState ?? "running",
    };
  }

  const base = {
    expectedStartTime: START,
    expectedSurfaceRef: "surface:35",
    recheck: foundRecheck(),
    surface: FOUND_SURFACE,
  };

  test("全て一致なら ok", () => {
    expect(evaluateRecheck(base).ok).toBe(true);
  });

  test("recheck check_failed なら中止 (check_failed)", () => {
    const d = evaluateRecheck({
      ...base,
      recheck: { kind: "check_failed", error: "ps -p timeout" },
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("check_failed");
  });

  test("recheck not_found なら中止 (dead)", () => {
    const d = evaluateRecheck({ ...base, recheck: { kind: "not_found" } });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("dead");
  });

  test("startTime 不一致なら中止 (dead, pid 再利用)", () => {
    const d = evaluateRecheck({
      ...base,
      recheck: foundRecheck({ startTime: "Sun May 18 12:00:00 2026" }),
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("dead");
  });

  test("fg でなくなったら中止 (background)", () => {
    const d = evaluateRecheck({
      ...base,
      recheck: foundRecheck({ isForeground: false }),
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("background");
  });

  test("suspended になったら中止 (suspended)", () => {
    const d = evaluateRecheck({
      ...base,
      recheck: foundRecheck({ runState: "suspended" }),
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("suspended");
  });

  test("surface 再解決が check_failed なら中止 (check_failed)", () => {
    const d = evaluateRecheck({
      ...base,
      surface: { kind: "check_failed", error: "cmux down" },
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("check_failed");
  });

  test("surface 再解決が no_surface なら中止 (no_cmux_surface)", () => {
    const d = evaluateRecheck({
      ...base,
      surface: { kind: "no_surface" },
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("no_cmux_surface");
  });

  test("surfaceRef が初回と変わったら中止 (no_cmux_surface)", () => {
    const d = evaluateRecheck({
      ...base,
      surface: { kind: "found", surfaceRef: "surface:99" },
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("no_cmux_surface");
  });
});

// ----------------------------------------------------------------------------
// evaluateScreenGuard
// ----------------------------------------------------------------------------

describe("evaluateScreenGuard", () => {
  test("fg かつ running かつ surface 引ければ allow", () => {
    const d = evaluateScreenGuard({
      proc: foundProc(),
      surface: FOUND_SURFACE,
    });
    expect(d.allow).toBe(true);
    if (d.allow) expect(d.surfaceRef).toBe("surface:35");
  });

  test("state を問わない (running 状態でも allow される)", () => {
    // screen は metaState 引数を取らないので、proc/surface が OK なら allow。
    const d = evaluateScreenGuard({
      proc: foundProc({ runState: "running" }),
      surface: FOUND_SURFACE,
    });
    expect(d.allow).toBe(true);
  });

  test("background は background で拒否", () => {
    const d = evaluateScreenGuard({
      proc: foundProc({ isForeground: false }),
      surface: FOUND_SURFACE,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("background");
  });

  test("suspended は suspended で拒否", () => {
    const d = evaluateScreenGuard({
      proc: foundProc({ runState: "suspended" }),
      surface: FOUND_SURFACE,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("suspended");
  });

  test("not_found は not_found で拒否", () => {
    const d = evaluateScreenGuard({
      proc: { kind: "not_found" },
      surface: FOUND_SURFACE,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("not_found");
  });

  test("no_surface は no_cmux_surface で拒否", () => {
    const d = evaluateScreenGuard({
      proc: foundProc(),
      surface: { kind: "no_surface" },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("no_cmux_surface");
  });

  test("check_failed は check_failed で拒否", () => {
    const d = evaluateScreenGuard({
      proc: { kind: "check_failed", error: "ps fail" },
      surface: FOUND_SURFACE,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("check_failed");
  });
});
