/**
 * message.ts のクリティカル経路 (送信・受信・状態遷移) 統合テスト。
 *
 * リファクタの safety net として、シグネチャと挙動の不変条件を確認する。
 * env (CMUXMSG_BASE / CMUX_WORKSPACE_ID / CMUXMSG_SESSION_ID) を切り替えて
 * tmp ディレクトリ上で I/O を実際に走らせる。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { sendMessage } from "./sender";
import { listInbox, readMessage, countInbox } from "./inbox";
import { acceptMessage, dismissMessage, replyMessage } from "./transition";
import { parseFrontmatter } from "./frontmatter";

const SELF = "11111111-1111-1111-1111-111111111111";
const PEER_A = "22222222-2222-2222-2222-222222222222";
const PEER_B = "33333333-3333-3333-3333-333333333333";
const WS = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

let workDir: string;
let originalEnv: { [k: string]: string | undefined };

function dir(sid: string): string {
  return path.join(workDir, WS, sid);
}

function makeSession(sid: string): void {
  for (const sub of ["inbox", "accepted", "archive", "sent", "tmp"]) {
    fs.mkdirSync(path.join(dir(sid), sub), { recursive: true });
  }
}

function setSelf(sid: string): void {
  process.env.CMUXMSG_SESSION_ID = sid;
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "message-test-"));
  originalEnv = {
    CMUXMSG_BASE: process.env.CMUXMSG_BASE,
    CMUX_WORKSPACE_ID: process.env.CMUX_WORKSPACE_ID,
    CMUXMSG_SESSION_ID: process.env.CMUXMSG_SESSION_ID,
    CMUXMSG_PRIORITY: process.env.CMUXMSG_PRIORITY,
    CMUXMSG_TYPE: process.env.CMUXMSG_TYPE,
    CMUXMSG_REPLY_TO: process.env.CMUXMSG_REPLY_TO,
  };
  delete process.env.CMUXMSG_PRIORITY;
  delete process.env.CMUXMSG_TYPE;
  delete process.env.CMUXMSG_REPLY_TO;
  process.env.CMUXMSG_BASE = workDir;
  process.env.CMUX_WORKSPACE_ID = WS;

  makeSession(SELF);
  makeSession(PEER_A);
  makeSession(PEER_B);
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("sendMessage", () => {
  test("相手の inbox にメッセージを配置する", async () => {
    setSelf(SELF);
    const filename = await sendMessage({ target: PEER_A, body: "hi" });
    expect(filename).toMatch(/^\d{8}T\d{6}-[0-9a-f]{8}\.md$/);
    const inboxFile = path.join(dir(PEER_A), "inbox", filename);
    expect(fs.existsSync(inboxFile)).toBe(true);
    const content = fs.readFileSync(inboxFile, "utf-8");
    const { meta, body } = parseFrontmatter(content);
    expect(meta.from).toBe(SELF);
    expect(meta.to).toBe(PEER_A);
    expect(meta.type).toBe("request");
    expect(meta.priority).toBe("normal");
    expect(meta.created_at).toBeTruthy();
    expect(body).toBe("hi");
  });

  test("送信側 sent/ にも hardlink でコピーが残る (同 inode)", async () => {
    setSelf(SELF);
    const filename = await sendMessage({ target: PEER_A, body: "hi" });
    const inboxFile = path.join(dir(PEER_A), "inbox", filename);
    const sentFile = path.join(dir(SELF), "sent", filename);
    expect(fs.existsSync(sentFile)).toBe(true);
    // 同じ inode (hardlink)
    const inboxStat = fs.statSync(inboxFile);
    const sentStat = fs.statSync(sentFile);
    expect(sentStat.ino).toBe(inboxStat.ino);
  });

  test("type を上書き可能", async () => {
    setSelf(SELF);
    const filename = await sendMessage({
      target: PEER_A,
      body: "x",
      type: "broadcast",
    });
    const content = fs.readFileSync(
      path.join(dir(PEER_A), "inbox", filename),
      "utf-8"
    );
    expect(parseFrontmatter(content).meta.type).toBe("broadcast");
  });

  test("CMUXMSG_PRIORITY=urgent で urgent 送信", async () => {
    setSelf(SELF);
    process.env.CMUXMSG_PRIORITY = "urgent";
    const filename = await sendMessage({ target: PEER_A, body: "x" });
    const content = fs.readFileSync(
      path.join(dir(PEER_A), "inbox", filename),
      "utf-8"
    );
    expect(parseFrontmatter(content).meta.priority).toBe("urgent");
  });

  test("不在 peer への送信はエラー", async () => {
    setSelf(SELF);
    await expect(
      sendMessage({ target: "44444444-4444-4444-4444-444444444444", body: "x" })
    ).rejects.toThrow(/見つかりません/);
  });

  test("不正な session_id への送信はエラー", async () => {
    setSelf(SELF);
    await expect(
      sendMessage({ target: "not-a-uuid", body: "x" })
    ).rejects.toThrow();
  });
});

describe("listInbox / countInbox / readMessage", () => {
  test("空 inbox は空配列・0", async () => {
    setSelf(PEER_A);
    expect(listInbox()).toEqual([]);
    expect(countInbox()).toBe(0);
  });

  test("受信メッセージを列挙、frontmatter フィールドを抽出", async () => {
    setSelf(SELF);
    const f1 = await sendMessage({ target: PEER_A, body: "first" });
    const f2 = await sendMessage({ target: PEER_A, body: "second" });

    setSelf(PEER_A);
    const list = listInbox();
    expect(list.length).toBe(2);
    expect(list[0]?.from).toBe(SELF);
    expect(list[0]?.type).toBe("request");
    expect(countInbox()).toBe(2);

    // readMessage で本文取得 (filename は ts+rand のソート順なので、明示的に指定)
    expect(readMessage(f1)).toContain("first");
    expect(readMessage(f2)).toContain("second");
  });

  test("読み込み失敗は throw", () => {
    setSelf(PEER_A);
    expect(() => readMessage("nonexistent.md")).toThrow();
  });
});

describe("acceptMessage", () => {
  test("inbox → accepted に移動、read_at を追記", async () => {
    setSelf(SELF);
    const filename = await sendMessage({ target: PEER_A, body: "x" });

    setSelf(PEER_A);
    acceptMessage(filename);
    expect(fs.existsSync(path.join(dir(PEER_A), "inbox", filename))).toBe(false);
    const accepted = path.join(dir(PEER_A), "accepted", filename);
    expect(fs.existsSync(accepted)).toBe(true);
    const content = fs.readFileSync(accepted, "utf-8");
    expect(parseFrontmatter(content).meta.read_at).toBeTruthy();
  });

  test("inbox に無いファイルは throw", () => {
    setSelf(PEER_A);
    expect(() => acceptMessage("nonexistent.md")).toThrow();
  });
});

describe("dismissMessage", () => {
  test("inbox → archive に移動、read_at + archive_at を追記", async () => {
    setSelf(SELF);
    const filename = await sendMessage({ target: PEER_A, body: "x" });

    setSelf(PEER_A);
    dismissMessage(filename);
    expect(fs.existsSync(path.join(dir(PEER_A), "inbox", filename))).toBe(false);
    const archive = path.join(dir(PEER_A), "archive", filename);
    expect(fs.existsSync(archive)).toBe(true);
    const meta = parseFrontmatter(fs.readFileSync(archive, "utf-8")).meta;
    expect(meta.read_at).toBeTruthy();
    expect(meta.archive_at).toBeTruthy();
  });
});

describe("replyMessage", () => {
  test("inbox にあるメッセージへの reply: accept → 返信送信 → archive", async () => {
    setSelf(SELF);
    const sentFilename = await sendMessage({ target: PEER_A, body: "question" });

    setSelf(PEER_A);
    const replyFilename = await replyMessage(sentFilename, "answer");

    // 元メッセージは PEER_A の archive へ
    expect(fs.existsSync(path.join(dir(PEER_A), "archive", sentFilename))).toBe(
      true
    );
    expect(fs.existsSync(path.join(dir(PEER_A), "inbox", sentFilename))).toBe(
      false
    );
    // 元メッセージに response_at + archive_at が入っている
    const meta = parseFrontmatter(
      fs.readFileSync(path.join(dir(PEER_A), "archive", sentFilename), "utf-8")
    ).meta;
    expect(meta.response_at).toBeTruthy();
    expect(meta.archive_at).toBeTruthy();

    // 返信は SELF の inbox に届く
    const replyContent = fs.readFileSync(
      path.join(dir(SELF), "inbox", replyFilename),
      "utf-8"
    );
    const replyMeta = parseFrontmatter(replyContent).meta;
    expect(replyMeta.from).toBe(PEER_A);
    expect(replyMeta.to).toBe(SELF);
    expect(replyMeta.type).toBe("response");
    expect(replyMeta.in_reply_to).toBe(sentFilename);

    // PEER_A の sent/ にも hardlink で残る
    expect(fs.existsSync(path.join(dir(PEER_A), "sent", replyFilename))).toBe(
      true
    );
  });

  test("既に accept 済みメッセージへの reply も成立", async () => {
    setSelf(SELF);
    const sentFilename = await sendMessage({ target: PEER_A, body: "q" });

    setSelf(PEER_A);
    acceptMessage(sentFilename);
    await replyMessage(sentFilename, "a");
    expect(fs.existsSync(path.join(dir(PEER_A), "archive", sentFilename))).toBe(
      true
    );
  });

  test("from が無いメッセージへの reply は throw", async () => {
    setSelf(PEER_A);
    // 直接 inbox に from なしファイルを置く
    const file = "20260101T000000-deadbeef.md";
    fs.writeFileSync(
      path.join(dir(PEER_A), "inbox", file),
      "---\nto: x\n---\n\nbody"
    );
    await expect(replyMessage(file, "x")).rejects.toThrow();
  });

  test("inbox/accepted どちらにも無いと throw", async () => {
    setSelf(PEER_A);
    await expect(replyMessage("ghost.md", "x")).rejects.toThrow();
  });
});

describe("送信→受信のラウンドトリップ", () => {
  test("PEER_A → PEER_B の送信が PEER_B 視点で見えて、reply が PEER_A 視点で見える", async () => {
    // PEER_A 視点で送信
    setSelf(PEER_A);
    const f1 = await sendMessage({ target: PEER_B, body: "ping" });

    // PEER_B 視点で受信して reply
    setSelf(PEER_B);
    expect(countInbox()).toBe(1);
    const f2 = await replyMessage(f1, "pong");

    // PEER_A 視点で reply を受信
    setSelf(PEER_A);
    expect(countInbox()).toBe(1);
    const list = listInbox();
    expect(list[0]?.filename).toBe(f2);
    expect(list[0]?.in_reply_to).toBe(f1);
  });
});
