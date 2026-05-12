import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { readMetaByDir, readMetaBySid, warnIfCrossHome } from "./meta";
import type { PeerMeta } from "../types";

const SID = "11111111-1111-1111-1111-111111111111";
let workDir: string;
let originalEnv: { [k: string]: string | undefined };
let stderrBuf: string;
let origStderrWrite: typeof process.stderr.write;

function makeMeta(overrides: Partial<PeerMeta> = {}): PeerMeta {
  return {
    session_id: SID,
    claude_home: "/home/u/.claude",
    workspace_id: "WS1",
    cwd: "/repo/foo",
    tags: [],
    state: "idle",
    state_changed_at: "2026-05-12T00:00:00+09:00",
    init_at: "2026-05-12T00:00:00+09:00",
    last_started_at: "2026-05-12T00:00:00+09:00",
    shell_pid: 1234,
    ...overrides,
  };
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-test-"));
  originalEnv = {
    CMUXMSG_BASE: process.env.CMUXMSG_BASE,
    CMUX_WORKSPACE_ID: process.env.CMUX_WORKSPACE_ID,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  };
  process.env.CMUXMSG_BASE = workDir;
  process.env.CMUX_WORKSPACE_ID = "WS1";
  process.env.CLAUDE_CONFIG_DIR = "/home/u/.claude";
  stderrBuf = "";
  origStderrWrite = process.stderr.write.bind(process.stderr);
  // stderr を string にキャプチャ (warnIfCrossHome は process.stderr.write を直接呼ぶ)
  process.stderr.write = ((s: string | Uint8Array) => {
    stderrBuf += typeof s === "string" ? s : new TextDecoder().decode(s);
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = origStderrWrite;
  fs.rmSync(workDir, { recursive: true, force: true });
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("readMetaByDir", () => {
  test("meta.json があれば返す", () => {
    const dir = path.join(workDir, SID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ session_id: SID }));
    expect(readMetaByDir(dir)?.session_id).toBe(SID);
  });

  test("無ければ null", () => {
    expect(readMetaByDir(path.join(workDir, SID))).toBeNull();
  });

  test("壊れた JSON は null", () => {
    const dir = path.join(workDir, SID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), "not json");
    expect(readMetaByDir(dir)).toBeNull();
  });
});

describe("readMetaBySid", () => {
  test("peerDir(sid)/meta.json を読む", () => {
    const dir = path.join(workDir, SID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ session_id: SID }));
    expect(readMetaBySid(SID)?.session_id).toBe(SID);
  });
});

describe("warnIfCrossHome", () => {
  test("同じ claude_home なら何もしない", () => {
    warnIfCrossHome(makeMeta({ claude_home: "/home/u/.claude" }));
    expect(stderrBuf).toBe("");
  });

  test("違う claude_home なら stderr に warning", () => {
    warnIfCrossHome(makeMeta({ claude_home: "/home/u/.claude-work" }));
    expect(stderrBuf).toContain("別の claude_home");
    expect(stderrBuf).toContain("/home/u/.claude-work");
    expect(stderrBuf).toContain("/home/u/.claude");
  });

  test("meta が null なら何もしない (壊れた peer)", () => {
    warnIfCrossHome(null);
    expect(stderrBuf).toBe("");
  });

  test("CLAUDE_CONFIG_DIR 未設定時はデフォルト ~/.claude と比較", () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const home = path.join(os.homedir(), ".claude");
    warnIfCrossHome(makeMeta({ claude_home: home }));
    expect(stderrBuf).toBe(""); // 一致するので warn なし

    warnIfCrossHome(makeMeta({ claude_home: "/totally/other" }));
    expect(stderrBuf).toContain("別の claude_home");
  });
});
