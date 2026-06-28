/**
 * DR-0016: SQLite hybrid 状態管理の基盤層。
 *
 * - sessions / session_labels / messages / subscribers を真実源として持つ
 * - メッセージ本体 file (= <base>/msg/*.md, <sid>/inbox/*.md) は別ファイル管理
 * - WAL + busy_timeout で multi-process 並行 (agmsg lib/storage.sh パターン借用)
 * - 検証: docs/findings/2026-06-17-bun-sqlite-concurrency.md
 */
import { Database } from "bun:sqlite";
import * as path from "path";
import { getMsgBase } from "./paths";

/** DR-0013 で ccmsg.db に rename 予定 (= 名称負債を一度だけ集約)。 */
export const DB_FILENAME = "cmux-msg.db";

export function getDbPath(): string {
  return path.join(getMsgBase(), DB_FILENAME);
}

export const SCHEMA_VERSION = 2;

const PRAGMAS = [
  "PRAGMA journal_mode=WAL",
  "PRAGMA busy_timeout=5000",
  "PRAGMA synchronous=NORMAL",
  "PRAGMA foreign_keys=ON",
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- セッション = 真実源 (sid の全状態)
CREATE TABLE IF NOT EXISTS sessions (
  sid          TEXT PRIMARY KEY,
  home         TEXT NOT NULL,
  cwd          TEXT NOT NULL,
  cwd_hash     TEXT NOT NULL,
  ws           TEXT,
  ws_hash      TEXT,
  repo         TEXT,
  repo_hash    TEXT,
  state        TEXT NOT NULL,
  pid          INTEGER NOT NULL,
  started_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  meta_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd  ON sessions(cwd_hash, state);
CREATE INDEX IF NOT EXISTS idx_sessions_ws   ON sessions(ws_hash, state);
CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo_hash, state);
CREATE INDEX IF NOT EXISTS idx_sessions_home ON sessions(home, state);

-- ラベル (動的、n:n)
CREATE TABLE IF NOT EXISTS session_labels (
  sid    TEXT NOT NULL REFERENCES sessions(sid) ON DELETE CASCADE,
  label  TEXT NOT NULL,
  PRIMARY KEY (sid, label)
);
CREATE INDEX IF NOT EXISTS idx_labels_label ON session_labels(label);

-- メッセージ (配送 queue、本体は file)
CREATE TABLE IF NOT EXISTS messages (
  msg_id                TEXT PRIMARY KEY,
  from_sid              TEXT,
  from_ws_hash          TEXT,
  from_repo_hash        TEXT,
  from_cwd_hash         TEXT,
  from_labels_json      TEXT,
  from_home             TEXT,
  target_kind           TEXT NOT NULL,
  target_value          TEXT NOT NULL,
  body_path             TEXT NOT NULL,
  priority              INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  consumed_by           TEXT,
  consumed_at           INTEGER,
  original_target_sid   TEXT,
  original_target_kind  TEXT,
  also_received_by_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_target    ON messages(target_kind, target_value, consumed_by);
CREATE INDEX IF NOT EXISTS idx_messages_from_sid  ON messages(from_sid);
CREATE INDEX IF NOT EXISTS idx_messages_from_repo ON messages(from_repo_hash);
CREATE INDEX IF NOT EXISTS idx_messages_from_ws   ON messages(from_ws_hash);

-- subscribe 状態 (watermark + 二重起動防止 lock)
-- lock_lstart: PID 再利用 false-positive 対策 (DR 候補, v2 で追加)。lock holder の
--              プロセス開始時刻 (= ps -o lstart) を併せて記録し、生存判定で
--              「PID alive + lstart 一致」を AND する。
CREATE TABLE IF NOT EXISTS subscribers (
  sid           TEXT PRIMARY KEY REFERENCES sessions(sid) ON DELETE CASCADE,
  watermark_id  TEXT,
  lock_pid      INTEGER,
  lock_at       INTEGER,
  lock_lstart   TEXT
);
`;

/**
 * 旧 schema (= v1 で作られた subscribers テーブル) に lock_lstart 列が無い場合に追加する。
 * IF NOT EXISTS 相当の動きを sqlite_master で確認してから ALTER TABLE する
 * (= SQLite には ADD COLUMN IF NOT EXISTS 構文がない)。
 */
function ensureSubscribersLockLstartColumn(db: Database): void {
  const cols = db
    .query("PRAGMA table_info(subscribers)")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "lock_lstart")) {
    db.exec("ALTER TABLE subscribers ADD COLUMN lock_lstart TEXT");
  }
}

/**
 * DB を開き、PRAGMA / schema / version migration を適用済の状態で返す。
 * 多重 open は安全 (CREATE TABLE IF NOT EXISTS / schema_version はベキ等)。
 */
export function openDb(dbPath: string = getDbPath()): Database {
  const db = new Database(dbPath, { create: true });
  for (const sql of PRAGMAS) db.exec(sql);
  db.exec(SCHEMA_SQL);

  // v1 → v2: subscribers に lock_lstart 列を追加 (旧 DB の rolling migration)。
  ensureSubscribersLockLstartColumn(db);

  const row = db.query("SELECT MAX(version) AS v FROM schema_version").get() as
    | { v: number | null }
    | null;
  const current = row?.v ?? 0;
  if (current < SCHEMA_VERSION) {
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
      SCHEMA_VERSION,
      Date.now(),
    );
  }
  return db;
}

/** 現在の schema_version を返す (= migration 完了確認用)。 */
export function currentSchemaVersion(db: Database): number {
  const row = db.query("SELECT MAX(version) AS v FROM schema_version").get() as
    | { v: number | null }
    | null;
  return row?.v ?? 0;
}
