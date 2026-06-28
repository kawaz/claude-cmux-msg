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

  test("tryAcquireLock 初回 (lock_pid IS NULL) は取得成功 (heldBy 無し)", () => {
    const r = tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    expect(r.acquired).toBe(true);
    expect(r.heldBy).toBeUndefined();
    expect(getLockInfo(db, "sid-1").pid).toBe(1001);
  });

  test("tryAcquireLock 同 PID 再取得はベキ等成功", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    const r = tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    expect(r.acquired).toBe(true);
    expect(r.heldBy).toBeUndefined();
  });

  test("tryAcquireLock 他 PID alive なら失敗 + heldBy にその PID を返す", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    const r = tryAcquireLock(db, "sid-1", 2002, alwaysAlive);
    expect(r.acquired).toBe(false);
    expect(r.heldBy).toBe(1001);
    expect(getLockInfo(db, "sid-1").pid).toBe(1001); // 不変
  });

  test("tryAcquireLock 他 PID dead なら奪取成功", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    const r = tryAcquireLock(db, "sid-1", 2002, alwaysDead);
    expect(r.acquired).toBe(true);
    expect(r.heldBy).toBeUndefined();
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

  test("signature: lstart 一致なら alive holder の奪取を拒否", () => {
    const lstartA = "Sat Jun 28 14:00:00 2026";
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive, 1, {
      getLstart: () => lstartA,
      myLstart: lstartA,
    });
    // 別 PID (2002) が「lstart 一致」を主張しても false (= 同名の本物)
    const r = tryAcquireLock(db, "sid-1", 2002, alwaysAlive, 2, {
      getLstart: () => lstartA,
      myLstart: lstartA,
    });
    expect(r.acquired).toBe(false);
    expect(r.heldBy).toBe(1001);
  });

  test("signature: lstart 不一致 (= PID 再利用) なら alive holder を stale 扱いで奪取", () => {
    const lstartA = "Sat Jun 28 14:00:00 2026";
    const lstartB = "Sat Jun 28 18:00:00 2026";
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive, 1, {
      getLstart: () => lstartA,
      myLstart: lstartA,
    });
    // PID 1001 は alive だが lstart が変わっている (= 再利用された別プロセス)
    const r = tryAcquireLock(db, "sid-1", 2002, alwaysAlive, 2, {
      getLstart: () => lstartB,
      myLstart: lstartB,
    });
    expect(r.acquired).toBe(true);
    expect(getLockInfo(db, "sid-1").pid).toBe(2002);
  });

  test("signature 未指定 (= 後方互換) は従来挙動 (alive holder を奪取しない)", () => {
    tryAcquireLock(db, "sid-1", 1001, alwaysAlive);
    const r = tryAcquireLock(db, "sid-1", 2002, alwaysAlive);
    expect(r.acquired).toBe(false);
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
