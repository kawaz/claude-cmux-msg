import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseSendArgs, resolveSendBody } from "./send";
import { UsageError } from "../lib/errors";

const TARGET = "11111111-1111-1111-1111-111111111111";

describe("parseSendArgs", () => {
  test("従来の <id> <msg...> 形式: msg を join", () => {
    const r = parseSendArgs([TARGET, "hello", "world"]);
    expect(r.target).toBe(TARGET);
    expect(r.body).toBe("hello world");
    expect(r.file).toBeUndefined();
  });

  test("<id> のみ (本文未指定): body と file は未設定", () => {
    const r = parseSendArgs([TARGET]);
    expect(r.target).toBe(TARGET);
    expect(r.body).toBeUndefined();
    expect(r.file).toBeUndefined();
  });

  test("--file <path>", () => {
    const r = parseSendArgs([TARGET, "--file", "msg.md"]);
    expect(r.target).toBe(TARGET);
    expect(r.body).toBeUndefined();
    expect(r.file).toBe("msg.md");
  });

  test("--file=<path>", () => {
    const r = parseSendArgs([TARGET, "--file=msg.md"]);
    expect(r.file).toBe("msg.md");
  });

  test("--file - で stdin 指定", () => {
    const r = parseSendArgs([TARGET, "--file", "-"]);
    expect(r.file).toBe("-");
  });

  test("引数なしは UsageError", () => {
    expect(() => parseSendArgs([])).toThrow(UsageError);
  });

  test("--file の値欠落は UsageError", () => {
    expect(() => parseSendArgs([TARGET, "--file"])).toThrow(UsageError);
  });

  test("--file と <message> 同時指定は UsageError", () => {
    expect(() =>
      parseSendArgs([TARGET, "msg", "--file", "x.md"])
    ).toThrow(UsageError);
  });

  test("--file は positional 引数のあとに来てもよい", () => {
    const r = parseSendArgs([TARGET, "--file", "x.md"]);
    expect(r.file).toBe("x.md");
  });
});

describe("resolveSendBody", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "send-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("body 指定があればそのまま返す", async () => {
    const r = await resolveSendBody({ target: TARGET, body: "hello" });
    expect(r).toBe("hello");
  });

  test("--file <path> でファイル内容を読む", async () => {
    const file = path.join(tmpDir, "msg.md");
    fs.writeFileSync(file, "from file");
    const r = await resolveSendBody({ target: TARGET, file });
    expect(r).toBe("from file");
  });

  test("--file <path> でファイルが無ければ throw", async () => {
    const file = path.join(tmpDir, "nope.md");
    await expect(
      resolveSendBody({ target: TARGET, file })
    ).rejects.toThrow();
  });
});
