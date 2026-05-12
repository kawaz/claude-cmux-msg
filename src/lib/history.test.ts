import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { listAllMessages, buildThread } from "./history";

const SELF = "11111111-1111-1111-1111-111111111111";
const PEER_A = "22222222-2222-2222-2222-222222222222";
const PEER_B = "33333333-3333-3333-3333-333333333333";
const WS = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

let workDir: string;
let originalEnv: { [k: string]: string | undefined };

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
  // self の dir を準備
  for (const sub of ["inbox", "accepted", "archive", "sent"]) {
    fs.mkdirSync(path.join(workDir, SELF, sub), { recursive: true });
  }
  originalEnv = {
    CMUXMSG_BASE: process.env.CMUXMSG_BASE,
    CMUX_WORKSPACE_ID: process.env.CMUX_WORKSPACE_ID,
    CMUXMSG_SESSION_ID: process.env.CMUXMSG_SESSION_ID,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
    CMUX_SURFACE_ID: process.env.CMUX_SURFACE_ID,
  };
  // 親プロセスが持つ CLAUDE_CODE_SESSION_ID が優先されてしまうので
  // テスト中は明示クリアして CMUXMSG_SESSION_ID で制御する
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CMUX_SURFACE_ID;
  process.env.CMUXMSG_BASE = workDir;
  process.env.CMUX_WORKSPACE_ID = WS;
  process.env.CMUXMSG_SESSION_ID = SELF;
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

function writeMsg(
  sub: "inbox" | "accepted" | "archive" | "sent",
  filename: string,
  meta: Record<string, string>,
  body: string
): void {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) lines.push(`${k}: ${v}`);
  lines.push("---", "", body);
  fs.writeFileSync(
    path.join(workDir, SELF, sub, filename),
    lines.join("\n")
  );
}

describe("listAllMessages", () => {
  test("inbox/accepted/archive/sent を時系列マージ", () => {
    writeMsg("inbox", "20260507T100000-aaaaaaaa.md", {
      from: PEER_A, to: SELF, type: "request", priority: "normal",
      created_at: "2026-05-07T10:00:00",
    }, "受信1");
    writeMsg("sent", "20260507T100100-bbbbbbbb.md", {
      from: SELF, to: PEER_A, type: "request", priority: "normal",
      created_at: "2026-05-07T10:01:00",
    }, "送信1");
    writeMsg("accepted", "20260507T100200-cccccccc.md", {
      from: PEER_B, to: SELF, type: "request", priority: "normal",
      created_at: "2026-05-07T10:02:00",
    }, "受信2");
    writeMsg("archive", "20260507T100300-dddddddd.md", {
      from: PEER_A, to: SELF, type: "request", priority: "normal",
      created_at: "2026-05-07T10:03:00",
    }, "アーカイブ");

    const records = listAllMessages(SELF);
    expect(records.length).toBe(4);
    expect(records.map((r) => r.filename)).toEqual([
      "20260507T100000-aaaaaaaa.md",
      "20260507T100100-bbbbbbbb.md",
      "20260507T100200-cccccccc.md",
      "20260507T100300-dddddddd.md",
    ]);
  });

  test("direction: sent/ にあれば out", () => {
    writeMsg("sent", "20260507T100100-bbbbbbbb.md", {
      from: SELF, to: PEER_A, type: "request", priority: "normal",
      created_at: "2026-05-07T10:01:00",
    }, "送信");
    writeMsg("inbox", "20260507T100200-cccccccc.md", {
      from: PEER_A, to: SELF, type: "response", priority: "normal",
      created_at: "2026-05-07T10:02:00",
    }, "受信");

    const records = listAllMessages(SELF);
    expect(records.find((r) => r.dir === "sent")?.direction).toBe("out");
    expect(records.find((r) => r.dir === "inbox")?.direction).toBe("in");
  });

  test("from が self なら out (sent/ がない旧データ)", () => {
    // 0.9.0 以前のデータ。inbox にあるが from が自分のメッセージ（broadcast 自身宛など）
    writeMsg("inbox", "20260507T100000-eeeeeeee.md", {
      from: SELF, to: SELF, type: "broadcast", priority: "normal",
      created_at: "2026-05-07T10:00:00",
    }, "自分から自分");

    const records = listAllMessages(SELF);
    expect(records[0]?.direction).toBe("out");
  });

  test("メタ情報のフィールドが正しく抽出される", () => {
    writeMsg("inbox", "20260507T100000-aaaaaaaa.md", {
      from: PEER_A, to: SELF, type: "request", priority: "urgent",
      created_at: "2026-05-07T10:00:00",
      in_reply_to: "20260507T095900-ffffffff.md",
    }, "本文");

    const [rec] = listAllMessages(SELF);
    expect(rec?.from).toBe(PEER_A);
    expect(rec?.to).toBe(SELF);
    expect(rec?.type).toBe("request");
    expect(rec?.priority).toBe("urgent");
    expect(rec?.in_reply_to).toBe("20260507T095900-ffffffff.md");
    expect(rec?.body).toBe("本文");
  });
});

describe("buildThread", () => {
  test("親方向に in_reply_to を遡る", () => {
    // sent: 自分が送った最初のメッセージ
    writeMsg("sent", "20260507T100000-aaaaaaaa.md", {
      from: SELF, to: PEER_A, type: "request", priority: "normal",
      created_at: "2026-05-07T10:00:00",
    }, "案を送る");
    // inbox: peer から返信 (in_reply_to: aaaa)
    writeMsg("inbox", "20260507T100100-bbbbbbbb.md", {
      from: PEER_A, to: SELF, type: "response", priority: "normal",
      created_at: "2026-05-07T10:01:00",
      in_reply_to: "20260507T100000-aaaaaaaa.md",
    }, "評価");
    // sent: 自分が peer の返信に返信 (in_reply_to: bbbb)
    writeMsg("sent", "20260507T100200-cccccccc.md", {
      from: SELF, to: PEER_A, type: "response", priority: "normal",
      created_at: "2026-05-07T10:02:00",
      in_reply_to: "20260507T100100-bbbbbbbb.md",
    }, "了解");

    const thread = buildThread("20260507T100200-cccccccc.md", SELF);
    expect(thread.map((r) => r.filename)).toEqual([
      "20260507T100000-aaaaaaaa.md",
      "20260507T100100-bbbbbbbb.md",
      "20260507T100200-cccccccc.md",
    ]);
  });

  test("子方向に in_reply_to を前方探索", () => {
    writeMsg("sent", "20260507T100000-aaaaaaaa.md", {
      from: SELF, to: PEER_A, type: "request", priority: "normal",
      created_at: "2026-05-07T10:00:00",
    }, "親メッセージ");
    writeMsg("inbox", "20260507T100100-bbbbbbbb.md", {
      from: PEER_A, to: SELF, type: "response", priority: "normal",
      created_at: "2026-05-07T10:01:00",
      in_reply_to: "20260507T100000-aaaaaaaa.md",
    }, "返信1");
    writeMsg("inbox", "20260507T100200-cccccccc.md", {
      from: PEER_A, to: SELF, type: "response", priority: "normal",
      created_at: "2026-05-07T10:02:00",
      in_reply_to: "20260507T100000-aaaaaaaa.md",
    }, "返信2");

    const thread = buildThread("20260507T100000-aaaaaaaa.md", SELF);
    expect(thread.length).toBe(3);
  });

  test("見つからない filename は空配列", () => {
    const thread = buildThread("nonexistent.md", SELF);
    expect(thread).toEqual([]);
  });

  test("無関係なメッセージは含まれない", () => {
    writeMsg("sent", "20260507T100000-aaaaaaaa.md", {
      from: SELF, to: PEER_A, type: "request", priority: "normal",
      created_at: "2026-05-07T10:00:00",
    }, "thread A 親");
    writeMsg("inbox", "20260507T100100-bbbbbbbb.md", {
      from: PEER_A, to: SELF, type: "response", priority: "normal",
      created_at: "2026-05-07T10:01:00",
      in_reply_to: "20260507T100000-aaaaaaaa.md",
    }, "thread A 返信");
    // 別 thread
    writeMsg("sent", "20260507T100200-cccccccc.md", {
      from: SELF, to: PEER_B, type: "request", priority: "normal",
      created_at: "2026-05-07T10:02:00",
    }, "別 thread");

    const thread = buildThread("20260507T100000-aaaaaaaa.md", SELF);
    expect(thread.length).toBe(2);
    expect(thread.map((r) => r.filename)).not.toContain(
      "20260507T100200-cccccccc.md"
    );
  });
});
