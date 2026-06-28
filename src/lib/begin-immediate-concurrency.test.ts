/**
 * BEGIN IMMEDIATE 並行 throw 解消の回帰テスト。
 *
 * 旧実装 (= plain db.transaction()、= BEGIN DEFERRED) は WAL モードで
 * READ → WRITE upgrade window で SQLITE_BUSY_SNAPSHOT を即時 throw する。
 * busy_timeout は SQLITE_BUSY には効くが SQLITE_BUSY_SNAPSHOT には効かない。
 *
 * 本テストは tryAcquireLock / tryClaimMessage を 20 並行で叩き、
 * SQLITE_BUSY 系の throw が起きないことを確認する。
 *
 * 真の bug 観測は workflow 調査時 (docs/issue/2026-06-28-begin-immediate-transaction.md)
 * の test-immediate.ts / test-actual-lock.ts で 12-16% 発火を確認済み。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { upsertSession, type SessionRow } from "./session-status";
import { tryAcquireLock } from "./subscriber-state";
import { tryClaimMessage } from "./message-queue";

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

describe("BEGIN IMMEDIATE 並行 throw 解消", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccmsg-immediate-test-"));
    dbPath = path.join(tmpDir, "x.db");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("tryAcquireLock が 20 並行で SQLITE_BUSY_SNAPSHOT を投げない", async () => {
    // 20 個の異なる sid を別 row として用意
    const setup = openDb(dbPath);
    const sids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const sid = `sid-immediate-${i.toString().padStart(2, "0")}`;
      sids.push(sid);
      seedSession(setup, sid);
    }
    setup.close();

    // 各 worker が別 connection を持つ (= multi-process と等価な状況)
    const tasks = sids.map(
      (sid, i) =>
        new Promise<{ ok: boolean; err?: string }>((resolve) => {
          // 全 worker をほぼ同時に起動する微小ランダム遅延無しで一斉発火
          queueMicrotask(() => {
            try {
              const db = openDb(dbPath);
              const r = tryAcquireLock(db, sid, 1000 + i, alwaysAlive);
              db.close();
              resolve({ ok: r.acquired });
            } catch (e) {
              resolve({ ok: false, err: e instanceof Error ? e.message : String(e) });
            }
          });
        }),
    );
    const results = await Promise.all(tasks);
    const errs = results.filter((r) => r.err);
    expect(errs).toEqual([]);
    // 全員別 sid なので全員 acquired=true になるはず
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("tryClaimMessage が 20 並行で SQLITE_BUSY_SNAPSHOT を投げない", async () => {
    const setup = openDb(dbPath);
    seedSession(setup, "sid-q");
    // 100 件の未消化 message を seed
    for (let i = 0; i < 100; i++) {
      setup
        .prepare(
          `INSERT INTO messages (msg_id, target_kind, target_value, body_path, priority, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(`msg-${i.toString().padStart(3, "0")}`, "sid", "sid-q", `/tmp/${i}.md`, 0, i);
    }
    setup.close();

    // 20 並行で同じ msg-000 を奪い合う + msg-001..099 を順に試す
    const tasks: Promise<{ won: number; err?: string }>[] = [];
    for (let w = 0; w < 20; w++) {
      tasks.push(
        new Promise((resolve) => {
          queueMicrotask(() => {
            try {
              const db = openDb(dbPath);
              let won = 0;
              for (let i = 0; i < 100; i++) {
                const ok = tryClaimMessage(
                  db,
                  `msg-${i.toString().padStart(3, "0")}`,
                  `worker-${w}`,
                  Date.now(),
                );
                if (ok) won++;
              }
              db.close();
              resolve({ won });
            } catch (e) {
              resolve({ won: 0, err: e instanceof Error ? e.message : String(e) });
            }
          });
        }),
      );
    }
    const results = await Promise.all(tasks);
    const errs = results.filter((r) => r.err);
    expect(errs).toEqual([]);
    // 全 worker の取得合計は 100 (= 漏れなし)
    const total = results.reduce((s, r) => s + r.won, 0);
    expect(total).toBe(100);
  });
});
