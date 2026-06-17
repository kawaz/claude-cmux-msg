import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { openDb, currentSchemaVersion, SCHEMA_VERSION } from "./db";

describe("openDb", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccmsg-db-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("新規 DB で schema_version=1 が記録される", () => {
    const db = openDb(path.join(tmpDir, "x.db"));
    expect(currentSchemaVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  test("PRAGMA が適用されている (journal_mode=wal, busy_timeout=5000, fk=1)", () => {
    const db = openDb(path.join(tmpDir, "x.db"));
    const jm = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    const bt = db.query("PRAGMA busy_timeout").get() as { timeout: number };
    const fk = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(jm.journal_mode).toBe("wal");
    expect(bt.timeout).toBe(5000);
    expect(fk.foreign_keys).toBe(1);
    db.close();
  });

  test("schema 適用済 (sessions/session_labels/messages/subscribers が存在)", () => {
    const db = openDb(path.join(tmpDir, "x.db"));
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("sessions");
    expect(names).toContain("session_labels");
    expect(names).toContain("messages");
    expect(names).toContain("subscribers");
    expect(names).toContain("schema_version");
    db.close();
  });

  test("再 open しても schema_version は重複 INSERT されない", () => {
    const dbPath = path.join(tmpDir, "x.db");
    const db1 = openDb(dbPath);
    db1.close();
    const db2 = openDb(dbPath);
    const rows = db2
      .query("SELECT COUNT(*) AS c FROM schema_version WHERE version = ?")
      .get(SCHEMA_VERSION) as { c: number };
    expect(rows.c).toBe(1);
    db2.close();
  });

  test("foreign_keys が有効 (session_labels が sessions に CASCADE)", () => {
    const db = openDb(path.join(tmpDir, "x.db"));
    db.prepare(
      "INSERT INTO sessions (sid, home, cwd, cwd_hash, state, pid, started_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("sid-1", "/home", "/cwd", "hash1", "idle", 100, 1, 1);
    db.prepare("INSERT INTO session_labels (sid, label) VALUES (?, ?)").run(
      "sid-1",
      "team-a",
    );
    expect(
      (
        db.query("SELECT COUNT(*) AS c FROM session_labels WHERE sid=?").get(
          "sid-1",
        ) as { c: number }
      ).c,
    ).toBe(1);
    db.prepare("DELETE FROM sessions WHERE sid=?").run("sid-1");
    expect(
      (
        db.query("SELECT COUNT(*) AS c FROM session_labels WHERE sid=?").get(
          "sid-1",
        ) as { c: number }
      ).c,
    ).toBe(0);
    db.close();
  });

  test("外部 sid を参照する session_labels INSERT は外部キー違反", () => {
    const db = openDb(path.join(tmpDir, "x.db"));
    expect(() =>
      db
        .prepare("INSERT INTO session_labels (sid, label) VALUES (?, ?)")
        .run("ghost-sid", "team-a"),
    ).toThrow();
    db.close();
  });
});
