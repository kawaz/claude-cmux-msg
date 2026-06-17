/**
 * DR-0016 stage C: subscribers テーブル (watermark + 二重起動防止 lock)。
 *
 * - watermark: subscribe が最後に emit した msg_id を永続化、再起動時 catch-up に使う
 * - lock: 同一 sid に subscribe が同時 2 つ起動するのを防ぐ
 *   - 自 PID が既に持っている → ベキ等成功
 *   - 他 PID が持つが dead (= isPidAlive(pid) === false) → 奪取
 *   - 他 PID が alive → 取得失敗
 *
 * PID 生存判定は呼出側で `process.kill(pid, 0)` 等。本モジュールは関数差し込み。
 */
import type { Database } from "bun:sqlite";

/** subscriber row が存在しなければ作る。INSERT OR IGNORE でベキ等。 */
export function ensureSubscriber(db: Database, sid: string): void {
  db.prepare("INSERT OR IGNORE INTO subscribers (sid) VALUES (?)").run(sid);
}

export function getWatermark(db: Database, sid: string): string | null {
  ensureSubscriber(db, sid);
  const r = db
    .query("SELECT watermark_id FROM subscribers WHERE sid = ?")
    .get(sid) as { watermark_id: string | null } | null;
  return r?.watermark_id ?? null;
}

export function setWatermark(
  db: Database,
  sid: string,
  watermarkId: string,
): void {
  ensureSubscriber(db, sid);
  db.prepare("UPDATE subscribers SET watermark_id = ? WHERE sid = ?").run(
    watermarkId,
    sid,
  );
}

export interface LockInfo {
  pid: number | null;
  at: number | null;
}

export function getLockInfo(db: Database, sid: string): LockInfo {
  const r = db
    .query("SELECT lock_pid, lock_at FROM subscribers WHERE sid = ?")
    .get(sid) as { lock_pid: number | null; lock_at: number | null } | null;
  return { pid: r?.lock_pid ?? null, at: r?.lock_at ?? null };
}

/**
 * lock を取得。transaction 内で「現状読み → 自 PID と比較 → 更新」を atomic に。
 *
 * 戻り値:
 * - true: 取得成功 (新規 / 自 PID ベキ等 / stale 奪取)
 * - false: 他 PID が alive で保持中
 */
export function tryAcquireLock(
  db: Database,
  sid: string,
  myPid: number,
  isPidAlive: (pid: number) => boolean,
  now: number = Date.now(),
): boolean {
  ensureSubscriber(db, sid);
  const tx = db.transaction((): boolean => {
    const cur = db
      .query("SELECT lock_pid FROM subscribers WHERE sid = ?")
      .get(sid) as { lock_pid: number | null } | null;
    const heldBy = cur?.lock_pid ?? null;
    if (heldBy === null || heldBy === myPid || !isPidAlive(heldBy)) {
      db.prepare(
        "UPDATE subscribers SET lock_pid = ?, lock_at = ? WHERE sid = ?",
      ).run(myPid, now, sid);
      return true;
    }
    return false;
  });
  return tx();
}

/** 自 PID が持っている時のみ release。他 PID への誤 release は no-op。 */
export function releaseLock(db: Database, sid: string, myPid: number): void {
  db.prepare(
    "UPDATE subscribers SET lock_pid = NULL, lock_at = NULL WHERE sid = ? AND lock_pid = ?",
  ).run(sid, myPid);
}
