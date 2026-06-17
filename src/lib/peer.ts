/**
 * peer (他セッション) の生存確認・列挙ヘルパ。
 *
 * `peers` / `broadcast` / `gc` 等で使う alive 判定を集約する。
 *
 * alive 判定は DR-0007 決定1 に従い `ps` の `--session-id <sid>` 照合を真実源と
 * する。peer ディレクトリ名がそのまま session_id (UUID) なので、ディレクトリ名を
 * `lookupSidProcess` に渡してプロセスの存在を確認する。
 *
 * 旧方式 (pid ファイル + lstart 一致) は廃止した。pid ファイルは alive 判定の
 * 唯一の読み手だったため不要になり、init.ts での書き込みも削除済み。プロセス
 * 連続性の検出は `meta.json` の `last_observed_pid` が担う (DR-0007 決定7)。
 */

import * as fs from "fs";
import * as path from "path";
import { isSessionId } from "./validate";
import {
  lookupSidProcess,
  lookupSidProcessBulk,
  type SidProcessLookup,
} from "./session-proc";

/**
 * 指定 PID のプロセスが alive か (シグナル 0 で生存確認)。
 * PID 1 (init) は親プロセス死亡時の orphan 扱いを避けるため dead 扱い。
 *
 * 補助関数。peer の alive 判定は `lookupSidProcess` ベース (sid 照合) を使う。
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
 * `lookupSidProcess` の結果から alive/dead を決める純粋関数 (DR-0007 決定1)。
 *
 * - `found`        → alive
 * - `not_found`    → dead (プロセス不在)
 * - `ambiguous`    → alive (並行 resume 等。プロセスは複数生きている)
 * - `check_failed` → alive (安全側。`ps` 失敗で生存を否定しきれないため、
 *                    dead と誤判定して broadcast 等から外すより alive 扱いが安全)
 */
export function aliveFromLookup(lookup: SidProcessLookup): boolean {
  switch (lookup.kind) {
    case "found":
      return true;
    case "not_found":
      return false;
    case "ambiguous":
      return true;
    case "check_failed":
      return true;
  }
}

/**
 * 指定 session_id の peer が alive か (`ps` の sid 照合、DR-0007 決定1)。
 */
export function isPeerAlive(sessionId: string): boolean {
  return aliveFromLookup(lookupSidProcess(sessionId));
}

export interface PeerEntry {
  sessionId: string;
  dir: string;
  alive: boolean;
}

/**
 * workspace 配下の peer (UUID 形式のセッションディレクトリ) を列挙する。
 * `by-surface` などのインデックスや内部状態ファイルは除外される。
 *
 * alive 判定はディレクトリ名 (= session_id) で `ps` を照合する。
 * peer 数 N に対して **`ps` は 1 回だけ実行** (= lookupSidProcessBulk)。
 */
export function listPeers(wsDir: string): PeerEntry[] {
  if (!fs.existsSync(wsDir)) return [];
  const entries = fs.readdirSync(wsDir, { withFileTypes: true });
  const sids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isSessionId(entry.name)) continue;
    sids.push(entry.name);
  }
  if (sids.length === 0) return [];
  const lookups = lookupSidProcessBulk(sids);
  return sids.map((sid) => ({
    sessionId: sid,
    dir: path.join(wsDir, sid),
    alive: aliveFromLookup(
      lookups.get(sid) ?? { kind: "check_failed", error: "missing in bulk result" },
    ),
  }));
}
