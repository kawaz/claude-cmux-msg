/**
 * DR-0016 stage D: messages テーブル CRUD + 取得者勝ち transaction。
 *
 * - body 本体は file (= body_path にパス保存)、本テーブルは配送 queue のメタのみ
 * - tryClaimMessage: BEGIN IMMEDIATE + UPDATE WHERE consumed_by IS NULL で
 *   取った者勝ち (= queue semantics、findings 2026-06-17 で integrity 確認済)
 * - from_*: 送信者揮発への備え (= 送信時点の snapshot を frontmatter と同形で保存)
 * - also_received_by: 共有 box 配信時の他 alive peer hint
 */
import type { Database } from "bun:sqlite";

export type TargetKind = "sid" | "cwd" | "ws" | "repo" | "label";

const ALL_TARGET_KINDS: TargetKind[] = ["sid", "cwd", "ws", "repo", "label"];

export interface MessageRow {
  msgId: string;
  fromSid: string | null;
  fromWsHash: string | null;
  fromRepoHash: string | null;
  fromCwdHash: string | null;
  fromLabels: string[] | null;
  fromHome: string | null;
  targetKind: TargetKind;
  targetValue: string;
  bodyPath: string;
  priority: number;
  createdAt: number;
  consumedBy: string | null;
  consumedAt: number | null;
  originalTargetSid: string | null;
  originalTargetKind: TargetKind | null;
  alsoReceivedBy: string[] | null;
}

interface RawMessageRow {
  msg_id: string;
  from_sid: string | null;
  from_ws_hash: string | null;
  from_repo_hash: string | null;
  from_cwd_hash: string | null;
  from_labels_json: string | null;
  from_home: string | null;
  target_kind: TargetKind;
  target_value: string;
  body_path: string;
  priority: number;
  created_at: number;
  consumed_by: string | null;
  consumed_at: number | null;
  original_target_sid: string | null;
  original_target_kind: TargetKind | null;
  also_received_by_json: string | null;
}

function parseJsonArray(s: string | null): string[] | null {
  if (s === null) return null;
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
    return null;
  } catch {
    return null;
  }
}

function fromRaw(r: RawMessageRow): MessageRow {
  return {
    msgId: r.msg_id,
    fromSid: r.from_sid,
    fromWsHash: r.from_ws_hash,
    fromRepoHash: r.from_repo_hash,
    fromCwdHash: r.from_cwd_hash,
    fromLabels: parseJsonArray(r.from_labels_json),
    fromHome: r.from_home,
    targetKind: r.target_kind,
    targetValue: r.target_value,
    bodyPath: r.body_path,
    priority: r.priority,
    createdAt: r.created_at,
    consumedBy: r.consumed_by,
    consumedAt: r.consumed_at,
    originalTargetSid: r.original_target_sid,
    originalTargetKind: r.original_target_kind,
    alsoReceivedBy: parseJsonArray(r.also_received_by_json),
  };
}

export function insertMessage(db: Database, row: MessageRow): void {
  if (!ALL_TARGET_KINDS.includes(row.targetKind)) {
    throw new Error(`invalid target_kind: ${row.targetKind}`);
  }
  db.prepare(
    `INSERT INTO messages
      (msg_id, from_sid, from_ws_hash, from_repo_hash, from_cwd_hash, from_labels_json, from_home,
       target_kind, target_value, body_path, priority, created_at,
       consumed_by, consumed_at,
       original_target_sid, original_target_kind, also_received_by_json)
     VALUES
      (?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?,
       ?, ?, ?)`,
  ).run(
    row.msgId,
    row.fromSid,
    row.fromWsHash,
    row.fromRepoHash,
    row.fromCwdHash,
    row.fromLabels === null ? null : JSON.stringify(row.fromLabels),
    row.fromHome,
    row.targetKind,
    row.targetValue,
    row.bodyPath,
    row.priority,
    row.createdAt,
    row.consumedBy,
    row.consumedAt,
    row.originalTargetSid,
    row.originalTargetKind,
    row.alsoReceivedBy === null ? null : JSON.stringify(row.alsoReceivedBy),
  );
}

export function getMessage(db: Database, msgId: string): MessageRow | null {
  const r = db
    .query("SELECT * FROM messages WHERE msg_id = ?")
    .get(msgId) as RawMessageRow | null;
  return r ? fromRaw(r) : null;
}

/**
 * queue 取得 (取った者勝ち)。
 * - 影響行数 = 1 なら自分が取った → true
 * - 影響行数 = 0 なら他が先に取った / 行不在 → false
 *
 * findings 2026-06-17 で 5 worker × 100 件並行 integrity 確認済。
 */
export function tryClaimMessage(
  db: Database,
  msgId: string,
  mySid: string,
  now: number = Date.now(),
): boolean {
  // BEGIN IMMEDIATE: 取得は WRITER 処理なので最初から WRITE lock を取り
  // SQLITE_BUSY_SNAPSHOT を回避 (findings/2026-06-17, findings/2026-06-28)。
  const tx = db.transaction((): boolean => {
    const r = db
      .prepare(
        "UPDATE messages SET consumed_by = ?, consumed_at = ? WHERE msg_id = ? AND consumed_by IS NULL",
      )
      .run(mySid, now, msgId);
    return r.changes === 1;
  });
  return tx.immediate();
}

export function listPendingForTarget(
  db: Database,
  kind: TargetKind,
  value: string,
  limit = 1000,
): MessageRow[] {
  const rows = db
    .query(
      `SELECT * FROM messages
        WHERE target_kind = ? AND target_value = ? AND consumed_by IS NULL
        ORDER BY priority DESC, created_at ASC
        LIMIT ?`,
    )
    .all(kind, value, limit) as RawMessageRow[];
  return rows.map(fromRaw);
}

export function listConsumedBySid(
  db: Database,
  sid: string,
  limit = 1000,
): MessageRow[] {
  const rows = db
    .query(
      `SELECT * FROM messages WHERE consumed_by = ?
        ORDER BY consumed_at DESC LIMIT ?`,
    )
    .all(sid, limit) as RawMessageRow[];
  return rows.map(fromRaw);
}

/** GC: 取得済かつ created_at < beforeTs の row を削除。戻り値 = 削除件数。 */
export function deleteOldConsumed(db: Database, beforeTs: number): number {
  const r = db
    .prepare(
      "DELETE FROM messages WHERE consumed_by IS NOT NULL AND created_at < ?",
    )
    .run(beforeTs);
  return r.changes;
}
