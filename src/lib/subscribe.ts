/**
 * subscribe の差分スキャンロジック（純粋関数）
 */

export interface DiffResult<T> {
  toEmit: T[];
  nextEmitted: Set<string>;
}

export function diffInbox<T extends { filename: string }>(
  emitted: Set<string>,
  current: T[]
): DiffResult<T> {
  const toEmit = current.filter((e) => !emitted.has(e.filename));
  const nextEmitted = new Set<string>(current.map((e) => e.filename));
  return { toEmit, nextEmitted };
}

/**
 * notify file の TTL (DR-0018: 12 分固定)。
 * subscribe rescan で TTL 超過 file を lazy unlink するときの判定に使う。
 */
export const NOTIFY_TTL_MS = 12 * 60 * 1000;

/**
 * notify subscribe stream emit の catch-up window (DR-0018: 60 秒固定)。
 * subscribe 起動時刻 - 60s より新しい file のみ emit する (= 再起動タイムラグ救済)。
 */
export const NOTIFY_CATCH_UP_SECONDS = 60;

/** notify 1 件をどう処理するか。 */
export type NotifyDecision = "emit" | "skip" | "unlink";

/**
 * notify file 1 件の処理を決める純粋関数 (DR-0018)。
 *
 * - now - createdAtMs > NOTIFY_TTL_MS  → unlink (TTL 超過、再起動時のゴミ流入防止)
 * - createdAtMs < subscribeStartedAt - catchUpSeconds*1000 → skip
 *   (起動時刻より catch-up 窓外に古い = 陳腐化 / 誤実行リスク)
 * - それ以外 → emit
 *
 * createdAtMs が NaN (= 不正な timestamp) なら "emit" を返す (= 安全側、消さない)。
 */
export function decideNotify(
  createdAtMs: number,
  now: number,
  subscribeStartedAt: number,
  catchUpSeconds: number,
): NotifyDecision {
  if (Number.isNaN(createdAtMs)) return "emit";
  if (now - createdAtMs > NOTIFY_TTL_MS) return "unlink";
  if (createdAtMs < subscribeStartedAt - catchUpSeconds * 1000) return "skip";
  return "emit";
}
