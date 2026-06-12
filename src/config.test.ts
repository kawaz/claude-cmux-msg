import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { requireCmux, requireSessionId } from "./config";

let originalEnv: { [k: string]: string | undefined };

beforeEach(() => {
  originalEnv = {
    CMUX_WORKSPACE_ID: process.env.CMUX_WORKSPACE_ID,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
    CMUXMSG_SESSION_ID: process.env.CMUXMSG_SESSION_ID,
    CMUX_SURFACE_ID: process.env.CMUX_SURFACE_ID,
  };
  delete process.env.CMUX_WORKSPACE_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CMUXMSG_SESSION_ID;
  delete process.env.CMUX_SURFACE_ID;
});

afterEach(() => {
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("requireSessionId", () => {
  test("session_id が解決できれば throw しない (CMUX_WORKSPACE_ID 不要)", () => {
    process.env.CLAUDE_CODE_SESSION_ID =
      "11111111-1111-1111-1111-111111111111";
    // CMUX_WORKSPACE_ID は未設定のまま
    expect(() => requireSessionId()).not.toThrow();
  });

  test("session_id が解決できなければ throw する", () => {
    // env が全て無いので解決不能
    expect(() => requireSessionId()).toThrow(/session_id を解決できません/);
  });
});

describe("requireCmux", () => {
  test("CMUX_WORKSPACE_ID と session_id が両方あれば throw しない", () => {
    process.env.CMUX_WORKSPACE_ID = "WS1";
    process.env.CLAUDE_CODE_SESSION_ID =
      "22222222-2222-2222-2222-222222222222";
    expect(() => requireCmux()).not.toThrow();
  });

  test("CMUX_WORKSPACE_ID が無ければ throw する (session_id があっても)", () => {
    process.env.CLAUDE_CODE_SESSION_ID =
      "33333333-3333-3333-3333-333333333333";
    // CMUX_WORKSPACE_ID 未設定
    expect(() => requireCmux()).toThrow(/CMUX_WORKSPACE_ID/);
  });

  test("session_id が解決できなければ throw する (CMUX_WORKSPACE_ID があっても)", () => {
    process.env.CMUX_WORKSPACE_ID = "WS1";
    expect(() => requireCmux()).toThrow(/session_id を解決できません/);
  });
});
