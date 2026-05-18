import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { isProcessAlive, aliveFromLookup, listPeers } from "./peer";
import type { SidProcessLookup } from "./session-proc";

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-test-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const SID_A = "11111111-1111-1111-1111-111111111111";
const SID_B = "22222222-2222-2222-2222-222222222222";

function makePeerDir(sid: string): void {
  fs.mkdirSync(path.join(workDir, sid), { recursive: true });
}

describe("isProcessAlive", () => {
  test("自分の PID は alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("PID 1 は dead 扱い", () => {
    expect(isProcessAlive(1)).toBe(false);
  });

  test("存在しない PID は dead", () => {
    expect(isProcessAlive(2147483646)).toBe(false);
  });
});

describe("aliveFromLookup", () => {
  test("found は alive", () => {
    const l: SidProcessLookup = {
      kind: "found",
      pid: 100,
      tty: "ttys000",
      pgid: 100,
      tpgid: 100,
      startTime: "Sun May 18 10:00:00 2026",
      isForeground: true,
      runState: "running",
    };
    expect(aliveFromLookup(l)).toBe(true);
  });

  test("not_found は dead", () => {
    expect(aliveFromLookup({ kind: "not_found" })).toBe(false);
  });

  test("ambiguous は alive 扱い (並行 resume でプロセスは生きている)", () => {
    expect(
      aliveFromLookup({
        kind: "ambiguous",
        procs: [
          { pid: 100, startTime: "a" },
          { pid: 200, startTime: "b" },
        ],
      })
    ).toBe(true);
  });

  test("check_failed は安全側で alive 扱い (生存を否定しきれない)", () => {
    expect(
      aliveFromLookup({ kind: "check_failed", error: "ps timeout" })
    ).toBe(true);
  });
});

describe("listPeers", () => {
  test("UUID 形式のディレクトリのみ列挙", () => {
    makePeerDir(SID_A);
    makePeerDir(SID_B);
    fs.mkdirSync(path.join(workDir, "by-surface"), { recursive: true });
    fs.mkdirSync(path.join(workDir, "broadcast"), { recursive: true });
    fs.writeFileSync(path.join(workDir, ".last-worker-surface"), "x");

    const peers = listPeers(workDir);
    expect(peers.map((p) => p.sessionId).sort()).toEqual([SID_A, SID_B]);
  });

  test("alive 判定は sid の ps 照合で行う (検出されないテスト用 sid は dead)", () => {
    // テスト用 UUID は実プロセスに存在しないので not_found → dead
    makePeerDir(SID_A);
    const peers = listPeers(workDir);
    const a = peers.find((p) => p.sessionId === SID_A);
    expect(a?.alive).toBe(false);
  });

  test("存在しないディレクトリでは空配列", () => {
    expect(listPeers(path.join(workDir, "nonexistent"))).toEqual([]);
  });
});
