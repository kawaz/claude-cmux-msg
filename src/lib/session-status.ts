/**
 * DR-0016 stage B: sessions テーブル + session_labels (n:n) の CRUD。
 *
 * - upsertSession: INSERT ON CONFLICT DO UPDATE (= session_labels を保持しつつ row 更新)
 * - 軸 (cwd_hash / ws_hash / repo_hash / home / label) ごとに alive な sid を引く
 * - 死んだ session は deleteSession で ON DELETE CASCADE が labels / subscribers を巻き込む
 */
import type { Database } from "bun:sqlite";

export type SessionState =
  | "idle"
  | "running"
  | "awaiting_permission"
  | "stopped";

const ALIVE_STATES: SessionState[] = ["idle", "running", "awaiting_permission"];

export interface SessionRow {
  sid: string;
  home: string;
  cwd: string;
  cwdHash: string;
  ws: string | null;
  wsHash: string | null;
  repo: string | null;
  repoHash: string | null;
  state: SessionState;
  pid: number;
  startedAt: number;
  lastSeen: number;
  metaJson: string | null;
}

interface RawSessionRow {
  sid: string;
  home: string;
  cwd: string;
  cwd_hash: string;
  ws: string | null;
  ws_hash: string | null;
  repo: string | null;
  repo_hash: string | null;
  state: SessionState;
  pid: number;
  started_at: number;
  last_seen: number;
  meta_json: string | null;
}

function fromRaw(r: RawSessionRow): SessionRow {
  return {
    sid: r.sid,
    home: r.home,
    cwd: r.cwd,
    cwdHash: r.cwd_hash,
    ws: r.ws,
    wsHash: r.ws_hash,
    repo: r.repo,
    repoHash: r.repo_hash,
    state: r.state,
    pid: r.pid,
    startedAt: r.started_at,
    lastSeen: r.last_seen,
    metaJson: r.meta_json,
  };
}

export function upsertSession(db: Database, row: SessionRow): void {
  db.prepare(
    `INSERT INTO sessions
      (sid, home, cwd, cwd_hash, ws, ws_hash, repo, repo_hash, state, pid, started_at, last_seen, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sid) DO UPDATE SET
       home = excluded.home,
       cwd = excluded.cwd,
       cwd_hash = excluded.cwd_hash,
       ws = excluded.ws,
       ws_hash = excluded.ws_hash,
       repo = excluded.repo,
       repo_hash = excluded.repo_hash,
       state = excluded.state,
       pid = excluded.pid,
       started_at = excluded.started_at,
       last_seen = excluded.last_seen,
       meta_json = excluded.meta_json`,
  ).run(
    row.sid,
    row.home,
    row.cwd,
    row.cwdHash,
    row.ws,
    row.wsHash,
    row.repo,
    row.repoHash,
    row.state,
    row.pid,
    row.startedAt,
    row.lastSeen,
    row.metaJson,
  );
}

export function getSession(db: Database, sid: string): SessionRow | null {
  const r = db
    .query("SELECT * FROM sessions WHERE sid = ?")
    .get(sid) as RawSessionRow | null;
  return r ? fromRaw(r) : null;
}

export function updateState(
  db: Database,
  sid: string,
  state: SessionState,
  lastSeen: number = Date.now(),
): void {
  db.prepare("UPDATE sessions SET state = ?, last_seen = ? WHERE sid = ?").run(
    state,
    lastSeen,
    sid,
  );
}

export function touchLastSeen(
  db: Database,
  sid: string,
  lastSeen: number = Date.now(),
): void {
  db.prepare("UPDATE sessions SET last_seen = ? WHERE sid = ?").run(lastSeen, sid);
}

/** ON DELETE CASCADE で session_labels / subscribers も自動削除。 */
export function deleteSession(db: Database, sid: string): void {
  db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
}

function listBy(
  db: Database,
  column: string,
  value: string,
  aliveOnly: boolean,
): SessionRow[] {
  let sql = `SELECT * FROM sessions WHERE ${column} = ?`;
  const params: (string | number)[] = [value];
  if (aliveOnly) {
    sql += ` AND state IN (${ALIVE_STATES.map(() => "?").join(", ")})`;
    params.push(...ALIVE_STATES);
  }
  sql += " ORDER BY last_seen DESC";
  const rows = db.query(sql).all(...params) as RawSessionRow[];
  return rows.map(fromRaw);
}

export function listSessionsByHome(
  db: Database,
  home: string,
  aliveOnly = true,
): SessionRow[] {
  return listBy(db, "home", home, aliveOnly);
}

export function listSessionsByCwd(
  db: Database,
  cwdHash: string,
  aliveOnly = true,
): SessionRow[] {
  return listBy(db, "cwd_hash", cwdHash, aliveOnly);
}

export function listSessionsByWs(
  db: Database,
  wsHash: string,
  aliveOnly = true,
): SessionRow[] {
  return listBy(db, "ws_hash", wsHash, aliveOnly);
}

export function listSessionsByRepo(
  db: Database,
  repoHash: string,
  aliveOnly = true,
): SessionRow[] {
  return listBy(db, "repo_hash", repoHash, aliveOnly);
}

export function listAliveSessions(db: Database): SessionRow[] {
  const rows = db
    .query(
      `SELECT * FROM sessions WHERE state IN (${ALIVE_STATES.map(() => "?").join(", ")})
       ORDER BY last_seen DESC`,
    )
    .all(...ALIVE_STATES) as RawSessionRow[];
  return rows.map(fromRaw);
}

// ===== labels (n:n) =====

/** カンマ区切り受付。INSERT OR IGNORE で重複貼りはノーオペ。 */
export function addLabels(db: Database, sid: string, labels: string[]): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO session_labels (sid, label) VALUES (?, ?)",
  );
  const tx = db.transaction((sid_: string, labels_: string[]) => {
    for (const l of labels_) stmt.run(sid_, l);
  });
  tx(sid, labels);
}

export function removeLabels(db: Database, sid: string, labels: string[]): void {
  const stmt = db.prepare(
    "DELETE FROM session_labels WHERE sid = ? AND label = ?",
  );
  const tx = db.transaction((sid_: string, labels_: string[]) => {
    for (const l of labels_) stmt.run(sid_, l);
  });
  tx(sid, labels);
}

export function listLabels(db: Database, sid: string): string[] {
  const rows = db
    .query("SELECT label FROM session_labels WHERE sid = ? ORDER BY label")
    .all(sid) as { label: string }[];
  return rows.map((r) => r.label);
}

export function listSessionsByLabel(
  db: Database,
  label: string,
  aliveOnly = true,
): SessionRow[] {
  let sql = `SELECT s.* FROM sessions s
             INNER JOIN session_labels l ON l.sid = s.sid
             WHERE l.label = ?`;
  const params: (string | number)[] = [label];
  if (aliveOnly) {
    sql += ` AND s.state IN (${ALIVE_STATES.map(() => "?").join(", ")})`;
    params.push(...ALIVE_STATES);
  }
  sql += " ORDER BY s.last_seen DESC";
  const rows = db.query(sql).all(...params) as RawSessionRow[];
  return rows.map(fromRaw);
}
