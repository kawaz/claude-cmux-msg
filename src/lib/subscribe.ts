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
