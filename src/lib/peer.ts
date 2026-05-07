/**
 * peer (他セッション) の生存確認・列挙ヘルパ。
 *
 * `peers` / `broadcast` 等で重複していた pid チェックを集約する。
 */

import * as fs from "fs";
import * as path from "path";
import { isSessionId } from "./validate";

/**
 * 指定 PID のプロセスが alive か。
 * PID 1 (init) は親プロセス死亡時の orphan 扱いを避けるため dead 扱い。
 */
export function isProcessAlive(pid: number): boolean {
  if (pid === 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * peer ディレクトリ (`<wsDir>/<sid>/`) の pid ファイルを読んで alive 判定。
 */
export function isPeerAlive(peerDir: string): boolean {
  const pidFile = path.join(peerDir, "pid");
  if (!fs.existsSync(pidFile)) return false;
  let pidStr: string;
  try {
    pidStr = fs.readFileSync(pidFile, "utf-8").trim();
  } catch {
    return false;
  }
  const pid = parseInt(pidStr, 10);
  if (isNaN(pid)) return false;
  return isProcessAlive(pid);
}

export interface PeerEntry {
  sessionId: string;
  dir: string;
  alive: boolean;
}

/**
 * workspace 配下の peer (UUID 形式のセッションディレクトリ) を列挙する。
 * `by-surface` などのインデックスや内部状態ファイルは除外される。
 */
export function listPeers(wsDir: string): PeerEntry[] {
  if (!fs.existsSync(wsDir)) return [];
  const entries = fs.readdirSync(wsDir, { withFileTypes: true });
  const result: PeerEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isSessionId(entry.name)) continue;
    const dir = path.join(wsDir, entry.name);
    result.push({
      sessionId: entry.name,
      dir,
      alive: isPeerAlive(dir),
    });
  }
  return result;
}
