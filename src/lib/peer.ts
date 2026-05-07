/**
 * peer (他セッション) の生存確認・列挙ヘルパ。
 *
 * `peers` / `broadcast` 等で重複していた pid チェックを集約する。
 *
 * pid ファイル形式 (新):
 *   1 行目: PID
 *   2 行目: ps -o lstart= の出力 (プロセス起動時刻)
 *
 * PID 単独だと PID 再利用で誤って alive 判定される (実機で alice2 dead に
 * broadcast が届いてしまった事例あり)。lstart 併記で「同一プロセスである」
 * ことを保証する。
 *
 * 旧形式 (PID 1 行のみ) は厳密性のため dead 扱いとする。一度 init すれば
 * 新形式に書き換わる。
 */

import * as fs from "fs";
import * as path from "path";
import { isSessionId } from "./validate";

/**
 * 指定 PID のプロセスが alive か (シグナル 0 で生存確認)。
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
 * 指定 PID の起動時刻 (ps -o lstart= 出力) を取得する。
 * mac/Linux 両対応。プロセスが存在しない場合は null。
 */
export function getProcessStartTime(pid: number): string | null {
  try {
    const proc = Bun.spawnSync({
      cmd: ["ps", "-o", "lstart=", "-p", String(pid)],
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = new TextDecoder().decode(proc.stdout).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * pid ファイル用の書き込み内容を生成する。
 * 形式: `<pid>\n<lstart>` (lstart 取得失敗時は PID 1 行のみ → 旧形式扱い)
 */
export function formatPidFile(pid: number): string {
  const lstart = getProcessStartTime(pid);
  return lstart ? `${pid}\n${lstart}` : `${pid}`;
}

/**
 * peer ディレクトリ (`<wsDir>/<sid>/`) の pid ファイルを読んで alive 判定。
 *
 * - 新形式 (PID + lstart 2 行): PID alive かつ lstart 一致で alive
 * - 旧形式 (PID 1 行のみ): 厳密性のため dead 扱い
 */
export function isPeerAlive(peerDir: string): boolean {
  const pidFile = path.join(peerDir, "pid");
  if (!fs.existsSync(pidFile)) return false;
  let content: string;
  try {
    content = fs.readFileSync(pidFile, "utf-8");
  } catch {
    return false;
  }
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l);
  if (lines.length < 2) return false; // 旧形式は dead 扱い
  const pid = parseInt(lines[0]!, 10);
  const recordedLstart = lines[1]!;
  if (isNaN(pid)) return false;
  if (!isProcessAlive(pid)) return false;
  const currentLstart = getProcessStartTime(pid);
  if (!currentLstart) return false;
  return currentLstart === recordedLstart;
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
