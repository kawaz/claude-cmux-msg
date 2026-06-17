import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { openDb } from "../lib/db";
import { upsertSession } from "../lib/session-status";

const BIN = path.resolve(import.meta.dir, "../cli.ts");
const SID = "11111111-1111-4111-8111-111111111111";

function runCli(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; code: number } {
  // CLAUDE_CODE_SESSION_ID が継承されると親セッションの sid が優先される (config.ts)
  // ので空文字で上書きして、CMUXMSG_SESSION_ID(SID) を真実源にする。
  const r = spawnSync(process.execPath, [BIN, ...args], {
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: "",
      CMUXMSG_SESSION_ID: SID,
      ...env,
    },
    encoding: "utf-8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
}

function seedSessionRow(baseDir: string) {
  const dbPath = path.join(baseDir, "cmux-msg.db");
  const db = openDb(dbPath);
  upsertSession(db, {
    sid: SID,
    home: "/h",
    cwd: "/c",
    cwdHash: "hc",
    ws: null,
    wsHash: null,
    repo: null,
    repoHash: null,
    state: "idle",
    pid: 1,
    startedAt: 0,
    lastSeen: 0,
    metaJson: null,
  });
  db.close();
}

describe("ccmsg label CLI (e2e)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccmsg-label-e2e-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("session row 不在なら usage error", () => {
    const r = runCli(["label", "list"], { CMUXMSG_BASE: tmpDir });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/sessions テーブルは SessionStart hook/);
  });

  test("seed 後: list は (labels なし)", () => {
    seedSessionRow(tmpDir);
    const r = runCli(["label", "list"], { CMUXMSG_BASE: tmpDir });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/labels なし/);
  });

  test("seed 後: add → list (カンマ区切り複数同時)", () => {
    seedSessionRow(tmpDir);
    const env = { CMUXMSG_BASE: tmpDir };

    const r2 = runCli(["label", "add", "team_a,team_b,role=tester"], env);
    expect(r2.code).toBe(0);
    expect(r2.stdout).toMatch(/追加.*team_a, team_b, role=tester/);

    const r3 = runCli(["label", "list"], env);
    expect(r3.code).toBe(0);
    const listed = r3.stdout.trim().split("\n").sort();
    expect(listed).toEqual(["role=tester", "team_a", "team_b"]);
  });

  test("seed 後: remove で複数同時剥がし", () => {
    seedSessionRow(tmpDir);
    const env = { CMUXMSG_BASE: tmpDir };

    runCli(["label", "add", "a,b,c"], env);
    const r = runCli(["label", "remove", "a,c"], env);
    expect(r.code).toBe(0);

    const r2 = runCli(["label", "list"], env);
    expect(r2.stdout.trim()).toBe("b");
  });

  test("seed 後: 不正な label 文字は usage error", () => {
    seedSessionRow(tmpDir);
    const r = runCli(["label", "add", "team-a"], { CMUXMSG_BASE: tmpDir });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/label に使えない文字/);
  });

  test("seed 後: add に引数なしは usage error", () => {
    seedSessionRow(tmpDir);
    const r = runCli(["label", "add"], { CMUXMSG_BASE: tmpDir });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/引数が必要/);
  });

  test("不明なサブコマンドは usage error", () => {
    seedSessionRow(tmpDir);
    const r = runCli(["label", "unknown"], { CMUXMSG_BASE: tmpDir });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/不明なサブコマンド/);
  });
});
