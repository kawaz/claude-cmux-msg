import { describe, test, expect } from "bun:test";
import { interpretWaitForResult } from "./cmux";

describe("interpretWaitForResult", () => {
  test("exit 0 は received", () => {
    expect(interpretWaitForResult({ exitCode: 0, stderr: "" })).toBe(
      "received"
    );
  });

  test("exit 0 で stderr に何か出ていても received 優先", () => {
    expect(
      interpretWaitForResult({ exitCode: 0, stderr: "warning: foo" })
    ).toBe("received");
  });

  test("exit 非0 かつ stderr に 'timed out' を含むなら timeout", () => {
    expect(
      interpretWaitForResult({
        exitCode: 1,
        stderr: "Error: wait-for timed out waiting for 'cmux-msg:ABC'",
      })
    ).toBe("timeout");
  });

  test("exit 非0 かつ socket 接続失敗は error", () => {
    expect(
      interpretWaitForResult({
        exitCode: 1,
        stderr:
          "Error: Failed to connect to socket at /tmp/cmux.sock (Operation not permitted, errno 1)",
      })
    ).toBe("error");
  });

  test("exit 非0 かつ stderr 空は error", () => {
    expect(interpretWaitForResult({ exitCode: 1, stderr: "" })).toBe(
      "error"
    );
  });

  test("exit 非0 かつ stderr に 'timed out' を含まない任意メッセージは error", () => {
    expect(
      interpretWaitForResult({ exitCode: 2, stderr: "something else" })
    ).toBe("error");
  });
});
