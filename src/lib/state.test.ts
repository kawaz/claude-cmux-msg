import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  transitionState,
  readMeta,
  updateMeta,
  mergeLastObservedPid,
} from "./state";
import type { PeerMeta } from "../types";
import type { SidProcessLookup } from "./session-proc";

const SID = "abcdef12-3456-7890-abcd-ef1234567890";
let workDir: string;
let originalEnv: { [k: string]: string | undefined };

function writeMeta(meta: Partial<PeerMeta>): void {
  const dir = path.join(workDir, SID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
}

function readRaw(): PeerMeta {
  return JSON.parse(
    fs.readFileSync(path.join(workDir, SID, "meta.json"), "utf-8")
  );
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "state-test-"));
  originalEnv = {
    CMUXMSG_BASE: process.env.CMUXMSG_BASE,
  };
  process.env.CMUXMSG_BASE = workDir;
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("readMeta", () => {
  test("meta.json が無ければ null", () => {
    expect(readMeta(SID)).toBeNull();
  });

  test("meta.json を読んで返す", () => {
    writeMeta({ session_id: SID, state: "idle" });
    const m = readMeta(SID);
    expect(m?.session_id).toBe(SID);
    expect(m?.state).toBe("idle");
  });

  test("壊れた JSON は null", () => {
    fs.mkdirSync(path.join(workDir, SID), { recursive: true });
    fs.writeFileSync(path.join(workDir, SID, "meta.json"), "not json");
    expect(readMeta(SID)).toBeNull();
  });
});

describe("transitionState", () => {
  test("state と state_changed_at を更新する", () => {
    writeMeta({
      session_id: SID,
      state: "idle",
      state_changed_at: "old",
    });
    transitionState(SID, "running");
    const m = readRaw();
    expect(m.state).toBe("running");
    expect(m.state_changed_at).not.toBe("old");
  });

  test("stopped 遷移時は last_ended_at を埋める", () => {
    writeMeta({ session_id: SID, state: "running" });
    transitionState(SID, "stopped");
    const m = readRaw();
    expect(m.state).toBe("stopped");
    expect(m.last_ended_at).toBeTruthy();
  });

  test("idle / running 遷移時は last_ended_at は触らない", () => {
    writeMeta({ session_id: SID, state: "idle" });
    transitionState(SID, "running");
    const m = readRaw();
    expect(m.last_ended_at).toBeUndefined();
  });

  test("meta が無いときは何もしない (例外も投げない)", () => {
    expect(() => transitionState(SID, "running")).not.toThrow();
    expect(fs.existsSync(path.join(workDir, SID, "meta.json"))).toBe(false);
  });
});

describe("mergeLastObservedPid", () => {
  const found: SidProcessLookup = {
    kind: "found",
    pid: 999,
    tty: "ttys001",
    pgid: 999,
    tpgid: 999,
    startTime: "Sun May 18 12:00:00 2026",
    isForeground: true,
    runState: "running",
  };

  test("found なら新しい (pid, start_time) を返す", () => {
    expect(mergeLastObservedPid(undefined, found)).toEqual({
      pid: 999,
      start_time: "Sun May 18 12:00:00 2026",
    });
  });

  test("not_found なら既存値を据え置く", () => {
    const cur = { pid: 1, start_time: "old" };
    expect(mergeLastObservedPid(cur, { kind: "not_found" })).toEqual(cur);
  });

  test("ambiguous なら既存値を据え置く", () => {
    const cur = { pid: 1, start_time: "old" };
    expect(
      mergeLastObservedPid(cur, { kind: "ambiguous", procs: [] })
    ).toEqual(cur);
  });

  test("check_failed なら既存値を据え置く", () => {
    const cur = { pid: 1, start_time: "old" };
    expect(
      mergeLastObservedPid(cur, { kind: "check_failed", error: "x" })
    ).toEqual(cur);
  });

  test("found 以外で既存値が undefined ならそのまま undefined", () => {
    expect(mergeLastObservedPid(undefined, { kind: "not_found" })).toBeUndefined();
  });
});

describe("transitionState last_observed_pid", () => {
  test("ps 照合できない環境では既存の last_observed_pid を維持する", () => {
    // テストランナー (bun) は SID の claude プロセスではないため not_found。
    // not_found では last_observed_pid を上書きしない。
    writeMeta({
      session_id: SID,
      state: "idle",
      last_observed_pid: { pid: 7, start_time: "Sun May 18 08:00:00 2026" },
    });
    transitionState(SID, "running");
    const m = readRaw();
    expect(m.last_observed_pid).toEqual({
      pid: 7,
      start_time: "Sun May 18 08:00:00 2026",
    });
  });
});

describe("updateMeta", () => {
  test("updater で書き換えた結果が永続化される", () => {
    writeMeta({ session_id: SID, state: "idle", tags: ["a"] });
    updateMeta(SID, (m) => ({ ...m, tags: ["a", "b"] }));
    expect(readRaw().tags).toEqual(["a", "b"]);
  });
});
