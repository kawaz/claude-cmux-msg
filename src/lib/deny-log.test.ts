import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  buildDenyLogLine,
  logDenyEvent,
  denyLogPath,
  type DenyEvent,
} from "./deny-log";

const SID = "abcdef12-3456-7890-abcd-ef1234567890";

describe("buildDenyLogLine (純粋関数)", () => {
  test("基本フィールド (ts / op / sid / reason / detail) を含む JSONL 1 行を返す", () => {
    const event: DenyEvent = {
      timestamp: "2026-05-18T12:34:56+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "busy",
      detail: "対象 sid は state=running です。",
    };
    const line = buildDenyLogLine(event);
    // 改行を含まない (1 イベント = 1 行)
    expect(line.includes("\n")).toBe(false);
    const parsed = JSON.parse(line);
    expect(parsed.timestamp).toBe("2026-05-18T12:34:56+09:00");
    expect(parsed.operation).toBe("tell");
    expect(parsed.session_id).toBe(SID);
    expect(parsed.reason).toBe("busy");
    expect(parsed.detail).toBe("対象 sid は state=running です。");
  });

  test("screen 操作種別も記録できる", () => {
    const line = buildDenyLogLine({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "screen",
      sessionId: SID,
      reason: "not_found",
    });
    expect(JSON.parse(line).operation).toBe("screen");
  });

  test("detail 省略時は detail フィールドを含めない", () => {
    const line = buildDenyLogLine({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "not_found",
    });
    const parsed = JSON.parse(line);
    expect("detail" in parsed).toBe(false);
  });

  test("関連 pid (単一) を記録できる", () => {
    const line = buildDenyLogLine({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "background",
      pids: [12345],
    });
    expect(JSON.parse(line).pids).toEqual([12345]);
  });

  test("ambiguous の衝突 pid 群を記録できる", () => {
    const line = buildDenyLogLine({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "ambiguous_concurrent_resume",
      pids: [111, 222, 333],
    });
    expect(JSON.parse(line).pids).toEqual([111, 222, 333]);
  });

  test("pids 省略時は pids フィールドを含めない", () => {
    const line = buildDenyLogLine({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "not_found",
    });
    expect("pids" in JSON.parse(line)).toBe(false);
  });

  test("pids が空配列なら pids フィールドを含めない", () => {
    const line = buildDenyLogLine({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "not_found",
      pids: [],
    });
    expect("pids" in JSON.parse(line)).toBe(false);
  });

  test.each([
    "not_found",
    "cross_home",
    "ambiguous_concurrent_resume",
    "ambiguous_unexpected",
    "no_cmux_surface",
    "background",
    "suspended",
    "dead",
    "unresponsive",
    "busy",
    "multiline",
    "check_failed",
  ] as const)("拒否理由コード %s をそのまま記録する", (reason) => {
    const line = buildDenyLogLine({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason,
    });
    expect(JSON.parse(line).reason).toBe(reason);
  });
});

describe("logDenyEvent (ファイル追記)", () => {
  let workDir: string;
  let originalBase: string | undefined;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "deny-log-test-"));
    originalBase = process.env.CMUXMSG_BASE;
    process.env.CMUXMSG_BASE = workDir;
  });

  afterEach(() => {
    if (originalBase === undefined) delete process.env.CMUXMSG_BASE;
    else process.env.CMUXMSG_BASE = originalBase;
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  test("ログファイルは <base>/logs/deny.jsonl", () => {
    expect(denyLogPath()).toBe(path.join(workDir, "logs", "deny.jsonl"));
  });

  test("logs ディレクトリが無くても作成して 1 行追記する", () => {
    logDenyEvent({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "busy",
    });
    const content = fs.readFileSync(denyLogPath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).reason).toBe("busy");
  });

  test("複数回呼ぶと追記される (上書きしない)", () => {
    logDenyEvent({
      timestamp: "2026-05-18T00:00:01+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "busy",
    });
    logDenyEvent({
      timestamp: "2026-05-18T00:00:02+09:00",
      operation: "screen",
      sessionId: SID,
      reason: "not_found",
    });
    const lines = fs
      .readFileSync(denyLogPath(), "utf-8")
      .trim()
      .split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).operation).toBe("tell");
    expect(JSON.parse(lines[1]!).operation).toBe("screen");
  });

  test("各行末は改行で終わる", () => {
    logDenyEvent({
      timestamp: "2026-05-18T00:00:00+09:00",
      operation: "tell",
      sessionId: SID,
      reason: "busy",
    });
    expect(fs.readFileSync(denyLogPath(), "utf-8").endsWith("\n")).toBe(true);
  });

  test("書き込み不能でも例外を投げない (握り潰す)", () => {
    // logs を file にして mkdir を失敗させる
    fs.writeFileSync(path.join(workDir, "logs"), "not a dir");
    expect(() =>
      logDenyEvent({
        timestamp: "2026-05-18T00:00:00+09:00",
        operation: "tell",
        sessionId: SID,
        reason: "busy",
      })
    ).not.toThrow();
  });
});
