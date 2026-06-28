import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { requireSessionId, getSessionId } from "./config";

let originalEnv: { [k: string]: string | undefined };

beforeEach(() => {
  originalEnv = {
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
    CMUXMSG_SESSION_ID: process.env.CMUXMSG_SESSION_ID,
  };
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CMUXMSG_SESSION_ID;
});

afterEach(() => {
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("getSessionId", () => {
  test("CLAUDE_CODE_SESSION_ID 優先", () => {
    process.env.CLAUDE_CODE_SESSION_ID =
      "11111111-1111-1111-1111-111111111111";
    process.env.CMUXMSG_SESSION_ID = "fallback";
    expect(getSessionId()).toBe("11111111-1111-1111-1111-111111111111");
  });

  test("CLAUDE_CODE_SESSION_ID 不在なら CMUXMSG_SESSION_ID", () => {
    process.env.CMUXMSG_SESSION_ID =
      "22222222-2222-2222-2222-222222222222";
    expect(getSessionId()).toBe("22222222-2222-2222-2222-222222222222");
  });

  test("両方無ければ空文字", () => {
    expect(getSessionId()).toBe("");
  });
});

describe("requireSessionId", () => {
  test("session_id が解決できれば throw しない", () => {
    process.env.CLAUDE_CODE_SESSION_ID =
      "11111111-1111-1111-1111-111111111111";
    expect(() => requireSessionId()).not.toThrow();
  });

  test("session_id が解決できなければ throw する", () => {
    expect(() => requireSessionId()).toThrow(/session_id を解決できません/);
  });
});
