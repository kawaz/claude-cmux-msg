import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { isProcessAlive, isPeerAlive, listPeers } from "./peer";

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "peer-test-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const SID_A = "11111111-1111-1111-1111-111111111111";
const SID_B = "22222222-2222-2222-2222-222222222222";

function makePeer(sid: string, pid: number | null): void {
  const dir = path.join(workDir, sid);
  fs.mkdirSync(dir, { recursive: true });
  if (pid !== null) {
    fs.writeFileSync(path.join(dir, "pid"), String(pid));
  }
}

describe("isProcessAlive", () => {
  test("自分の PID は alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("PID 1 は dead 扱い", () => {
    expect(isProcessAlive(1)).toBe(false);
  });

  test("存在しない PID は dead", () => {
    // 大きな PID は存在しないことが多い (max は OS 依存だが 2^31 級)
    expect(isProcessAlive(2147483646)).toBe(false);
  });
});

describe("isPeerAlive", () => {
  test("自分の PID 入りは alive", () => {
    makePeer(SID_A, process.pid);
    expect(isPeerAlive(path.join(workDir, SID_A))).toBe(true);
  });

  test("pid ファイルが無いと dead", () => {
    makePeer(SID_A, null);
    expect(isPeerAlive(path.join(workDir, SID_A))).toBe(false);
  });

  test("不正な PID 文字列は dead", () => {
    fs.mkdirSync(path.join(workDir, SID_A), { recursive: true });
    fs.writeFileSync(path.join(workDir, SID_A, "pid"), "not-a-number");
    expect(isPeerAlive(path.join(workDir, SID_A))).toBe(false);
  });
});

describe("listPeers", () => {
  test("UUID 形式のディレクトリのみ列挙", () => {
    makePeer(SID_A, process.pid);
    makePeer(SID_B, 1); // dead
    fs.mkdirSync(path.join(workDir, "by-surface"), { recursive: true });
    fs.mkdirSync(path.join(workDir, "broadcast"), { recursive: true });
    fs.writeFileSync(path.join(workDir, ".last-worker-surface"), "x");

    const peers = listPeers(workDir);
    expect(peers.map((p) => p.sessionId).sort()).toEqual([SID_A, SID_B]);
  });

  test("alive/dead が反映される", () => {
    makePeer(SID_A, process.pid);
    makePeer(SID_B, 1); // PID 1 は dead 扱い

    const peers = listPeers(workDir);
    const a = peers.find((p) => p.sessionId === SID_A);
    const b = peers.find((p) => p.sessionId === SID_B);
    expect(a?.alive).toBe(true);
    expect(b?.alive).toBe(false);
  });

  test("存在しないディレクトリでは空配列", () => {
    expect(listPeers(path.join(workDir, "nonexistent"))).toEqual([]);
  });
});
