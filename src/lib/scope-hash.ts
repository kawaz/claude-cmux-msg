/**
 * DR-0015 stage: cwd / ws / repo の正規化 + SHA-256 prefix。
 *
 * 軸ヒエラルキー sid ⊂ cwd ⊂ ws ⊂ repo (label は直交):
 * - cwd  = process.cwd() を正規化
 * - ws   = git worktree root (= git rev-parse --show-toplevel)、非 git なら cwd と同一
 * - repo = git common-dir の親 (= bare の親 or worktree 群の共通親)、非 git なら null
 *
 * 正規化: path.resolve → fs.realpathSync (symlink 追従) → 末尾 / 剥がし
 * ハッシュ: SHA-256 hex prefix 16 文字 (= 軸索引キー)
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

export const HASH_LENGTH = 16;

/** path を resolve → realpath → 末尾 / 剥がしの順で正規化。存在しないパスは resolve 結果を使う。 */
export function normalizePath(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // 存在しないパス: realpath は throw するので resolve のまま使う
  }
  if (resolved.length > 1 && resolved.endsWith(path.sep)) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

/** SHA-256 hex prefix 16 文字。 */
export function hashPath(normalizedPath: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizedPath)
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

/** cwd から ws (git worktree root) を引く。非 git 配下は cwd と同一にフォールバック (正規化済)。 */
export function detectWs(cwd: string): string {
  const normalizedCwd = normalizePath(cwd);
  const out = runGit(normalizedCwd, ["rev-parse", "--show-toplevel"]);
  if (out === null) return normalizedCwd;
  return normalizePath(out);
}

/** cwd から repo root を引く。非 git 配下は null。 */
export function detectRepo(cwd: string): string | null {
  const normalizedCwd = normalizePath(cwd);
  const out = runGit(normalizedCwd, ["rev-parse", "--git-common-dir"]);
  if (out === null) return null;
  const abs = path.isAbsolute(out) ? out : path.resolve(normalizedCwd, out);
  const commonDir = normalizePath(abs);
  // git-common-dir = .git の位置 (bare なら bare ディレクトリ自身)。
  // repo root はその親 (= kawaz の git bare + worktree 運用と整合)。
  return path.dirname(commonDir);
}

export interface ScopeHashes {
  cwd: string;
  cwdHash: string;
  ws: string;
  wsHash: string;
  repo: string | null;
  repoHash: string | null;
}

export function computeScopeHashes(cwd: string = process.cwd()): ScopeHashes {
  const normalizedCwd = normalizePath(cwd);
  const ws = detectWs(normalizedCwd);
  const repo = detectRepo(normalizedCwd);
  return {
    cwd: normalizedCwd,
    cwdHash: hashPath(normalizedCwd),
    ws,
    wsHash: hashPath(ws),
    repo,
    repoHash: repo === null ? null : hashPath(repo),
  };
}
