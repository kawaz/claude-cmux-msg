import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import {
  normalizePath,
  hashPath,
  detectWs,
  detectRepo,
  computeScopeHashes,
  HASH_LENGTH,
} from "./scope-hash";

describe("normalizePath", () => {
  test("実在する絶対パスは realpath 解決 (= macOS /tmp → /private/tmp)、末尾 / 剥がし", () => {
    const expected = fs.realpathSync("/tmp");
    expect(normalizePath("/tmp/")).toBe(expected);
  });

  test("相対パスは絶対化", () => {
    const r = normalizePath(".");
    expect(path.isAbsolute(r)).toBe(true);
  });

  test("存在しないパスでも resolve 結果を返す (throw しない)", () => {
    const fake = "/nonexistent-aabbccdd/xyz";
    const r = normalizePath(fake);
    expect(r).toBe(fake);
  });
});

describe("hashPath", () => {
  test(`SHA-256 hex prefix ${HASH_LENGTH} 文字`, () => {
    const h = hashPath("/x");
    expect(h).toHaveLength(HASH_LENGTH);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  test("同じ入力で同じ hash (決定的)", () => {
    expect(hashPath("/a/b")).toBe(hashPath("/a/b"));
  });

  test("異なる入力で異なる hash", () => {
    expect(hashPath("/a/b")).not.toBe(hashPath("/a/c"));
  });
});

describe("detectWs / detectRepo (git 環境)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-hash-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("git 配下: detectWs は worktree root", () => {
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmpDir, stdio: "ignore" });
    const sub = path.join(tmpDir, "sub", "dir");
    fs.mkdirSync(sub, { recursive: true });
    const ws = detectWs(sub);
    expect(ws).toBe(normalizePath(tmpDir));
  });

  test("git 配下: detectRepo は repo root", () => {
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmpDir, stdio: "ignore" });
    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub);
    const repo = detectRepo(sub);
    expect(repo).toBe(normalizePath(tmpDir));
  });

  test("非 git 配下: detectWs は cwd と同一にフォールバック", () => {
    const ws = detectWs(tmpDir);
    expect(ws).toBe(normalizePath(tmpDir));
  });

  test("非 git 配下: detectRepo は null", () => {
    expect(detectRepo(tmpDir)).toBeNull();
  });

  test("computeScopeHashes は cwd / ws / repo + 各 hash を返す", () => {
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmpDir, stdio: "ignore" });
    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub);
    const sh = computeScopeHashes(sub);
    expect(sh.cwd).toBe(normalizePath(sub));
    expect(sh.ws).toBe(normalizePath(tmpDir));
    expect(sh.repo).toBe(normalizePath(tmpDir));
    expect(sh.cwdHash).toHaveLength(HASH_LENGTH);
    expect(sh.wsHash).toHaveLength(HASH_LENGTH);
    expect(sh.repoHash).toHaveLength(HASH_LENGTH);
  });

  test("computeScopeHashes 非 git: repo / repoHash が null", () => {
    const sh = computeScopeHashes(tmpDir);
    expect(sh.repo).toBeNull();
    expect(sh.repoHash).toBeNull();
    // ws は cwd と同じ
    expect(sh.ws).toBe(sh.cwd);
    expect(sh.wsHash).toBe(sh.cwdHash);
  });
});
