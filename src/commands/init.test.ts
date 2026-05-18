import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { initWorkspace } from "./init";
import type { PeerMeta } from "../types";

const SID = "abcdef12-3456-7890-abcd-ef1234567890";
let workDir: string;
let originalEnv: { [k: string]: string | undefined };

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "init-test-"));
  originalEnv = {
    CMUXMSG_BASE: process.env.CMUXMSG_BASE,
    CMUXMSG_SESSION_ID: process.env.CMUXMSG_SESSION_ID,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
    CMUX_WORKSPACE_ID: process.env.CMUX_WORKSPACE_ID,
    CMUXMSG_TAGS: process.env.CMUXMSG_TAGS,
  };
  process.env.CMUXMSG_BASE = workDir;
  process.env.CMUXMSG_SESSION_ID = SID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CMUX_WORKSPACE_ID = "WS1";
  delete process.env.CMUXMSG_TAGS;
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

function readMeta(dir: string): PeerMeta {
  return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8"));
}

describe("initWorkspace", () => {
  test("meta.json と受信箱ディレクトリを作る", () => {
    const dir = path.join(workDir, SID);
    initWorkspace(dir, { cwd: workDir });
    expect(fs.existsSync(path.join(dir, "meta.json"))).toBe(true);
    for (const sub of ["inbox", "accepted", "archive", "sent", "tmp"]) {
      expect(fs.existsSync(path.join(dir, sub))).toBe(true);
    }
  });

  test("claude_pid フィールドは記録しない (last_observed_pid に移行済み)", () => {
    const dir = path.join(workDir, SID);
    initWorkspace(dir, { cwd: workDir });
    const meta = readMeta(dir);
    expect("claude_pid" in meta).toBe(false);
  });

  test("自分の sid を ps 照合できない環境では last_observed_pid は未設定", () => {
    // テストランナー (bun) は claude プロセスではないため sid 照合は not_found。
    // found 以外なので last_observed_pid は undefined のまま (JSON で省かれる)。
    const dir = path.join(workDir, SID);
    initWorkspace(dir, { cwd: workDir });
    const meta = readMeta(dir);
    expect(meta.last_observed_pid).toBeUndefined();
    // pid 不明時は pid ファイルも書かない
    expect(fs.existsSync(path.join(dir, "pid"))).toBe(false);
  });

  test("再 init で既存の last_observed_pid を維持する (照合失敗時)", () => {
    const dir = path.join(workDir, SID);
    fs.mkdirSync(dir, { recursive: true });
    const existing = {
      session_id: SID,
      last_observed_pid: { pid: 42, start_time: "Sun May 18 09:00:00 2026" },
      init_at: "2026-05-01T00:00:00+09:00",
    };
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify(existing)
    );
    initWorkspace(dir, { cwd: workDir });
    const meta = readMeta(dir);
    // ps 照合は not_found なので既存値を維持
    expect(meta.last_observed_pid).toEqual({
      pid: 42,
      start_time: "Sun May 18 09:00:00 2026",
    });
    // init_at も維持
    expect(meta.init_at).toBe("2026-05-01T00:00:00+09:00");
  });
});
