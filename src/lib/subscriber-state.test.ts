import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { upsertSession, type SessionRow } from "./session-status";
import {
  ensureSubscriber,
  getWatermark,
  setWatermark,
  getLockInfo,
  tryAcquireLock,
  releaseLock,
} from "./subscriber-state";

function seedSession(db: Database, sid: string) {
  const r: SessionRow = {
    sid,
    home: "/home",
    cwd: "/cwd",
    cwdHash: "h",
    ws: null,
    wsHash: null,
    repo: null,
    repoHash: null,
    state: "idle",
    pid: 100,
    startedAt: 1,
    lastSeen: 1,
    metaJson: null,
  };
  upsertSession(db, r);
}

const alwaysAlive = () => true;
const alwaysDead = () => false;

describe("subscriber-state", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccmsg-sub-test-"));
    db = openDb(path.join(tmpDir, "x.db"));
    seedSession(db, "sid-1");
  });
  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("ensureSubscriber はベキ等", () => {
    ensureSubscriber(db, "sid-1");
    ensureSubscriber(db, "sid-1");
    const c = (
      db
        .query("SELECT COUNT(*) AS c FROM subscribers WHERE sid = ?")
        .get("sid-1") as { c: number }
    ).c;
    expect(c).toBe(1);
  });

  test("watermark 初期は null, set/get ラウンドトリップ", () => {
    expect(getWatermark(db, "sid-1")).toBeNull();
    setWatermark(db, "sid-1", "msg-100");
    expect(getWatermark(db, "sid-1")).toBe("msg-100");
    setWatermark(db, "sid-1", "msg-200");
    expect(getWatermark(db, "sid-1")).toBe("msg-200");
  });

  test("tryAcquireLock 初回 (lock_pid IS NULL) は取得成功", () => {
    expect(tryAcquireLock(db, "sid-1", 1001, alwaysAlive)).toBe(true);
    expect(getLockInfo(db, "sid-1").pid).toBe(1001);
  });

  test("tryAcquireLock 同 PID 再取得はベキ等成功", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    expect(tryAcquireLock(db, "sid-1", 1001, alwaysAlive)).toBe(true);
  });

  test("tryAcquireLock 他 PID alive なら失敗 (取得不可)", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    expect(tryAcquireLock(db, "sid-1", 2002, alwaysAlive)).toBe(false);
    expect(getLockInfo(db, "sid-1").pid).toBe(1001); // 不変
  });

  test("tryAcquireLock 他 PID dead なら奪取成功", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    expect(tryAcquireLock(db, "sid-1", 2002, alwaysDead)).toBe(true);
    expect(getLockInfo(db, "sid-1").pid).toBe(2002);
  });

  test("releaseLock は自 PID 一致時のみ解放", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive, 555);
    releaseLock(db, "sid-1", 9999); // 他 PID → no-op
    expect(getLockInfo(db, "sid-1").pid).toBe(1001);
    releaseLock(db, "sid-1", 1001);
    expect(getLockInfo(db, "sid-1").pid).toBeNull();
    expect(getLockInfo(db, "sid-1").at).toBeNull();
  });

  test("lock_at が記録される (取得時刻)", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive, 12_345);
    expect(getLockInfo(db, "sid-1").at).toBe(12_345);
  });

  test("session 削除で subscribers も CASCADE 削除される", () => {
    setWatermark(db, "sid-1", "m1");
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    db.prepare("DELETE FROM sessions WHERE sid = ?").run("sid-1");
    const c = (
      db
        .query("SELECT COUNT(*) AS c FROM subscribers WHERE sid = ?")
        .get("sid-1") as { c: number }
    ).c;
    expect(c).toBe(0);
  });
});
