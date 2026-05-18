/**
 * セッションの state トラッキング (DR-0004)。
 *
 * 各 hook が状態遷移を起こすときに `transitionState(sid, newState)` を呼ぶ。
 * meta.json を読んで state / state_changed_at を書き換え、必要なら
 * last_started_at / last_ended_at も更新する。
 *
 * 原子的書き込みは tmp + rename で行う (sender.ts と同じパターン)。
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { getMsgBase, nowIso } from "../config";
import { readMetaBySid } from "./meta";
import { lookupSidProcess } from "./session-proc";
import type { SidProcessLookup } from "./session-proc";
import type { PeerMeta, SessionState } from "../types";

function metaPath(sessionId: string): string {
  return path.join(getMsgBase(), sessionId, "meta.json");
}

/**
 * 指定セッションの meta.json を読む。
 * (src/lib/meta.ts の readMetaBySid に委譲。state 関連の op で使うため re-export)
 */
export const readMeta = readMetaBySid;

/**
 * meta.json を原子的に書き換える。
 *
 * `updater` は現在の meta を受け取り、新しい meta を返す純粋関数。
 * 競合書き込みは tmp + rename で守るが、read-modify-write の race までは
 * 守らない (hook は基本 1 プロセスずつなので問題にならない)。
 */
export function updateMeta(
  sessionId: string,
  updater: (current: PeerMeta) => PeerMeta
): void {
  const current = readMeta(sessionId);
  if (!current) return; // meta が無いセッションは何もしない (init 前 hook 等)
  const next = updater(current);
  const p = metaPath(sessionId);
  const tmp = `${p}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, p);
}

/**
 * `lookupSidProcess` の結果を既存の `last_observed_pid` にマージする (DR-0007 決定7)。
 *
 * - `found` なら新しい `(pid, start_time)` を返す
 * - `found` 以外 (not_found / ambiguous / check_failed) は既存値を据え置く
 *   (上書きしない。誤って連続性情報を失わないため)
 *
 * 純粋関数として切り出してテスト可能にしている。
 */
export function mergeLastObservedPid(
  current: PeerMeta["last_observed_pid"],
  lookup: SidProcessLookup
): PeerMeta["last_observed_pid"] {
  if (lookup.kind === "found") {
    return { pid: lookup.pid, start_time: lookup.startTime };
  }
  return current;
}

/**
 * state を遷移させて state_changed_at を更新する。
 *
 * `stopped` への遷移時は last_ended_at も埋める。SessionStart で `idle` に
 * 戻す時は last_started_at を更新する (呼び出し側の責務として明示)。
 *
 * 併せて DR-0007 決定7 に従い `last_observed_pid` を更新する。自分の sid を
 * `ps` 照合し、`found` なら現在の claude pid / 起動時刻を記録、それ以外は据え置く。
 */
export function transitionState(sessionId: string, next: SessionState): void {
  const now = nowIso();
  const lookup = lookupSidProcess(sessionId);
  updateMeta(sessionId, (m) => ({
    ...m,
    state: next,
    state_changed_at: now,
    last_observed_pid: mergeLastObservedPid(m.last_observed_pid, lookup),
    ...(next === "stopped" ? { last_ended_at: now } : {}),
  }));
}
