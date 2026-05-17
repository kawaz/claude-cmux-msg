import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveClaudePid } from "./init";

describe("resolveClaudePid", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.CMUX_CLAUDE_PID;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CMUX_CLAUDE_PID;
    } else {
      process.env.CMUX_CLAUDE_PID = original;
    }
  });

  test("CMUX_CLAUDE_PID がセットされていればその値を使う", () => {
    process.env.CMUX_CLAUDE_PID = "98765";
    expect(resolveClaudePid()).toBe(98765);
  });

  test("CMUX_CLAUDE_PID 未設定なら process.ppid にフォールバック", () => {
    delete process.env.CMUX_CLAUDE_PID;
    expect(resolveClaudePid()).toBe(process.ppid || process.pid);
  });

  test("CMUX_CLAUDE_PID が空文字なら process.ppid にフォールバック", () => {
    process.env.CMUX_CLAUDE_PID = "";
    expect(resolveClaudePid()).toBe(process.ppid || process.pid);
  });

  test("CMUX_CLAUDE_PID が非数値 (NaN) なら process.ppid にフォールバック", () => {
    process.env.CMUX_CLAUDE_PID = "not-a-number";
    expect(resolveClaudePid()).toBe(process.ppid || process.pid);
  });
});
