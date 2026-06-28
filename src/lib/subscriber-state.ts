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
import { checkLockHolderSignature } from "./pid-signature";

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
 * lock 取得結果。
 * - acquired=true: 取得成功 (新規 / 自 PID ベキ等 / stale 奪取)
 * - acquired=false: 他 PID が alive で保持中。heldBy にその PID を入れて返す
 *   (= 呼び出し側がエラーメッセージに表示して利用者に kill 対象を伝えるため)
 */
export interface AcquireLockResult {
  acquired: boolean;
  heldBy?: number;
}

/**
 * tryAcquireLock のオプション (PID 再利用 false-positive 対策、後方互換 optional)。
 *
 * - getLstart: PID の lstart を取得する callback (= `ps -o lstart`)。null なら取得不能。
 * - myLstart: 自 PID の lstart (= 記録用)。未指定なら lstart を記録せず旧挙動。
 */
export interface AcquireLockSignatureOptions {
  getLstart?: (pid: number) => string | null;
  myLstart?: string | null;
}

/**
 * lock を取得。transaction 内で「現状読み → 自 PID と比較 → 更新」を atomic に。
 *
 * PID 再利用 false-positive 対策 (= holder lstart 検証) は signatureOpts が
 * 渡されたときのみ動く。未指定なら従来の alive 判定のみ (= 後方互換)。
 */
export function tryAcquireLock(
  db: Database,
  sid: string,
  myPid: number,
  isPidAlive: (pid: number) => boolean,
  now: number = Date.now(),
  signatureOpts: AcquireLockSignatureOptions = {},
): AcquireLockResult {
  ensureSubscriber(db, sid);
  const { getLstart, myLstart } = signatureOpts;
  // BEGIN IMMEDIATE で WRITER 取得を先頭に持ってくる (DEFERRED だと READ → UPDATE
  // upgrade window で SQLITE_BUSY_SNAPSHOT を即時 throw、busy_timeout retry 無効)。
  const tx = db.transaction((): AcquireLockResult => {
    const cur = db
      .query("SELECT lock_pid, lock_lstart FROM subscribers WHERE sid = ?")
      .get(sid) as
      | { lock_pid: number | null; lock_lstart: string | null }
      | null;
    const heldBy = cur?.lock_pid ?? null;
    const recordedLstart = cur?.lock_lstart ?? null;

    // 取得可否を判定
    let canAcquire = false;
    if (heldBy === null || heldBy === myPid) {
      canAcquire = true;
    } else {
      const heldByAlive = isPidAlive(heldBy);
      if (!heldByAlive) {
        canAcquire = true;
      } else if (getLstart && recordedLstart !== null) {
        // PID 再利用 false-positive 対策: lstart 一致なら同名 (= 奪取不可)、
        // 不一致なら別プロセス (= 奪取可能)
        const verdict = checkLockHolderSignature({
          heldByAlive: true,
          heldByLstart: getLstart(heldBy),
          recordedLstart,
        });
        canAcquire = verdict === "stale";
      }
    }

    if (canAcquire) {
      db.prepare(
        "UPDATE subscribers SET lock_pid = ?, lock_at = ?, lock_lstart = ? WHERE sid = ?",
      ).run(myPid, now, myLstart ?? null, sid);
      return { acquired: true };
    }
    return { acquired: false, heldBy: heldBy ?? undefined };
  });
  return tx.immediate();
}

/** 自 PID が持っている時のみ release。他 PID への誤 release は no-op。 */
export function releaseLock(db: Database, sid: string, myPid: number): void {
  db.prepare(
    "UPDATE subscribers SET lock_pid = NULL, lock_at = NULL, lock_lstart = NULL WHERE sid = ? AND lock_pid = ?",
  ).run(sid, myPid);
}
