import { describe, test, expect } from "bun:test";
import { interpretWaitForResult, isSurfaceSettled } from "./cmux";

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

describe("isSurfaceSettled", () => {
  test("prev=null は not settled (初回サンプルは比較相手なし)", () => {
    expect(isSurfaceSettled(null, "user@host ❯ ")).toBe(false);
  });

  test("curr が空文字なら not settled (画面がまだ描画されていない)", () => {
    expect(isSurfaceSettled("", "")).toBe(false);
  });

  test("curr が空白のみなら not settled", () => {
    expect(isSurfaceSettled("   \n  ", "   \n  ")).toBe(false);
  });

  test("prev が空で curr が非空 (変化あり) なら not settled", () => {
    expect(isSurfaceSettled("", "user@host ❯ ")).toBe(false);
  });

  test("非空かつ prev と curr が一致 (出力が落ち着いた) なら settled", () => {
    expect(isSurfaceSettled("user@host ❯ ", "user@host ❯ ")).toBe(true);
  });

  test("非空だが prev と curr が不一致 (出力変化中) なら not settled", () => {
    expect(isSurfaceSettled("Terminal", "user@host ❯ ")).toBe(false);
  });
});
