import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import {
  upsertSession,
  getSession,
  updateState,
  touchLastSeen,
  deleteSession,
  listSessionsByHome,
  listSessionsByCwd,
  listSessionsByWs,
  listSessionsByRepo,
  listAliveSessions,
  addLabels,
  removeLabels,
  listLabels,
  listSessionsByLabel,
  type SessionRow,
} from "./session-status";

function makeRow(sid: string, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    sid,
    home: "/home",
    cwd: "/cwd",
    cwdHash: "hash-cwd",
    ws: "/ws",
    wsHash: "hash-ws",
    repo: "/repo",
    repoHash: "hash-repo",
    state: "idle",
    pid: 100,
    startedAt: 1_000_000,
    lastSeen: 1_000_100,
    metaJson: null,
    ...overrides,
  };
}

describe("session-status", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccmsg-ss-test-"));
    db = openDb(path.join(tmpDir, "x.db"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("upsert + get でラウンドトリップ", () => {
    const r = makeRow("sid-1");
    upsertSession(db, r);
    expect(getSession(db, "sid-1")).toEqual(r);
  });

  test("upsert 2 回で row 更新 (重複 INSERT 例外なし、labels 保持)", () => {
    upsertSession(db, makeRow("sid-1", { state: "idle" }));
    addLabels(db, "sid-1", ["team-a", "role=tester"]);
    upsertSession(db, makeRow("sid-1", { state: "running", lastSeen: 9_999 }));
    const r = getSession(db, "sid-1");
    expect(r?.state).toBe("running");
    expect(r?.lastSeen).toBe(9_999);
    expect(listLabels(db, "sid-1")).toEqual(["role=tester", "team-a"]);
  });

  test("getSession 不在は null", () => {
    expect(getSession(db, "nope")).toBeNull();
  });

  test("updateState で state と last_seen を更新", () => {
    upsertSession(db, makeRow("sid-1"));
    updateState(db, "sid-1", "running", 5_555);
    const r = getSession(db, "sid-1");
    expect(r?.state).toBe("running");
    expect(r?.lastSeen).toBe(5_555);
  });

  test("touchLastSeen で last_seen のみ更新", () => {
    upsertSession(db, makeRow("sid-1", { state: "running", lastSeen: 1 }));
    touchLastSeen(db, "sid-1", 2_222);
    const r = getSession(db, "sid-1");
    expect(r?.state).toBe("running");
    expect(r?.lastSeen).toBe(2_222);
  });

  test("deleteSession で session 削除、labels も CASCADE", () => {
    upsertSession(db, makeRow("sid-1"));
    addLabels(db, "sid-1", ["team-a"]);
    deleteSession(db, "sid-1");
    expect(getSession(db, "sid-1")).toBeNull();
    expect(listLabels(db, "sid-1")).toEqual([]);
  });

  test("listSessionsByHome (default aliveOnly=true は stopped を除く)", () => {
    upsertSession(db, makeRow("sid-1", { home: "h1", state: "idle" }));
    upsertSession(db, makeRow("sid-2", { home: "h1", state: "running" }));
    upsertSession(db, makeRow("sid-3", { home: "h1", state: "stopped" }));
    upsertSession(db, makeRow("sid-4", { home: "h2", state: "idle" }));
    const xs = listSessionsByHome(db, "h1").map((s) => s.sid).sort();
    expect(xs).toEqual(["sid-1", "sid-2"]);
  });

  test("listSessionsByHome aliveOnly=false なら stopped も含む", () => {
    upsertSession(db, makeRow("sid-1", { home: "h1", state: "idle" }));
    upsertSession(db, makeRow("sid-2", { home: "h1", state: "stopped" }));
    const xs = listSessionsByHome(db, "h1", false).map((s) => s.sid).sort();
    expect(xs).toEqual(["sid-1", "sid-2"]);
  });

  test("listSessionsByCwd / ByWs / ByRepo は hash で絞り込み", () => {
    upsertSession(db, makeRow("sid-1", { cwdHash: "c1", wsHash: "w1", repoHash: "r1" }));
    upsertSession(db, makeRow("sid-2", { cwdHash: "c1", wsHash: "w2", repoHash: "r1" }));
    upsertSession(db, makeRow("sid-3", { cwdHash: "c2", wsHash: "w2", repoHash: "r2" }));
    expect(listSessionsByCwd(db, "c1").map((s) => s.sid).sort()).toEqual([
      "sid-1",
      "sid-2",
    ]);
    expect(listSessionsByWs(db, "w2").map((s) => s.sid).sort()).toEqual([
      "sid-2",
      "sid-3",
    ]);
    expect(listSessionsByRepo(db, "r1").map((s) => s.sid).sort()).toEqual([
      "sid-1",
      "sid-2",
    ]);
  });

  test("listAliveSessions は stopped 除外", () => {
    upsertSession(db, makeRow("sid-1", { state: "idle" }));
    upsertSession(db, makeRow("sid-2", { state: "stopped" }));
    expect(listAliveSessions(db).map((s) => s.sid)).toEqual(["sid-1"]);
  });

  test("addLabels は重複貼り無視 (= INSERT OR IGNORE)", () => {
    upsertSession(db, makeRow("sid-1"));
    addLabels(db, "sid-1", ["a", "b"]);
    addLabels(db, "sid-1", ["b", "c"]);
    expect(listLabels(db, "sid-1")).toEqual(["a", "b", "c"]);
  });

  test("removeLabels で複数同時剥がし", () => {
    upsertSession(db, makeRow("sid-1"));
    addLabels(db, "sid-1", ["a", "b", "c"]);
    removeLabels(db, "sid-1", ["a", "c"]);
    expect(listLabels(db, "sid-1")).toEqual(["b"]);
  });

  test("listSessionsByLabel で label を持つ alive sid", () => {
    upsertSession(db, makeRow("sid-1", { state: "idle" }));
    upsertSession(db, makeRow("sid-2", { state: "running" }));
    upsertSession(db, makeRow("sid-3", { state: "stopped" }));
    addLabels(db, "sid-1", ["team-a"]);
    addLabels(db, "sid-2", ["team-a"]);
    addLabels(db, "sid-3", ["team-a"]);
    expect(
      listSessionsByLabel(db, "team-a").map((s) => s.sid).sort(),
    ).toEqual(["sid-1", "sid-2"]);
  });

  test("listSessionsByLabel aliveOnly=false なら stopped も含む", () => {
    upsertSession(db, makeRow("sid-1", { state: "idle" }));
    upsertSession(db, makeRow("sid-2", { state: "stopped" }));
    addLabels(db, "sid-1", ["t"]);
    addLabels(db, "sid-2", ["t"]);
    expect(
      listSessionsByLabel(db, "t", false).map((s) => s.sid).sort(),
    ).toEqual(["sid-1", "sid-2"]);
  });

  test("ws / repo が null のセッションも upsert + get で扱える", () => {
    const r = makeRow("sid-1", { ws: null, wsHash: null, repo: null, repoHash: null });
    upsertSession(db, r);
    expect(getSession(db, "sid-1")).toEqual(r);
  });
});
