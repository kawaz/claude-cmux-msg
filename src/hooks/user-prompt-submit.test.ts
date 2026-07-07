import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { countUnread } from "./user-prompt-submit";

let inboxDir: string;
let workDir: string;

function writeMsg(filename: string, type: string): void {
  fs.writeFileSync(
    path.join(inboxDir, filename),
    `---\nfrom: 11111111-1111-1111-1111-111111111111\ntype: ${type}\n---\n\nbody`,
  );
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "user-prompt-submit-test-"));
  inboxDir = path.join(workDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("countUnread", () => {
  test("inbox 未初期化 (ディレクトリ不在) は 0", () => {
    expect(countUnread(path.join(workDir, "nonexistent"))).toBe(0);
  });

  test("空 inbox は 0", () => {
    expect(countUnread(inboxDir)).toBe(0);
  });

  test("request/response は未読カウントに含める", () => {
    writeMsg("20260101T000000-aaaaaaaa.md", "request");
    writeMsg("20260101T000001-bbbbbbbb.md", "response");
    expect(countUnread(inboxDir)).toBe(2);
  });

  // notify は subscribe stream で即時 emit 済みの軽量通知 (DR-0017/0018)。
  // read しても inbox file 自体は消えない (read はファイルを移動しない) ため、
  // 未読カウントに含めると「読んでも減らない」ノイズになる
  // (docs/issue/2026-07-07-notify-self-unread-never-clears.md)。
  test("notify は未読カウントから除外", () => {
    writeMsg("20260101T000000-cccccccc.md", "notify");
    expect(countUnread(inboxDir)).toBe(0);
  });

  test("notify と request が混在: notify だけ除外した件数", () => {
    writeMsg("20260101T000000-dddddddd.md", "request");
    writeMsg("20260101T000001-eeeeeeee.md", "notify");
    expect(countUnread(inboxDir)).toBe(1);
  });
});
