import { describe, test, expect } from "bun:test";
import { decideCheckSubscribe } from "./check-subscribe";

describe("decideCheckSubscribe", () => {
  const bin = "/plugin/bin/cmux-msg";

  test("sid 解決失敗時は exit code 2", () => {
    const d = decideCheckSubscribe("", false, bin);
    expect(d.exitCode).toBe(2);
    expect(d.stderr).toContain("sid を解決できません");
  });

  test("subscribe 検出時は exit code 0 / stderr 出力なし", () => {
    const d = decideCheckSubscribe("sid-1", true, bin);
    expect(d.exitCode).toBe(0);
    expect(d.stderr).toBe("");
  });

  test("subscribe 未検出時は exit code 1 + 起動コマンド付き stderr", () => {
    const d = decideCheckSubscribe("sid-1", false, bin);
    expect(d.exitCode).toBe(1);
    expect(d.stderr).toContain("subscribe が claude の子孫プロセスに見つかりません");
    // pluginBin が起動コマンドにそのまま含まれていること (引数組立余地ゼロ)
    expect(d.stderr).toContain(`  ${bin} subscribe`);
    expect(d.stderr).toContain("Monitor");
  });

  test("sid 空かつ検出 true でも exit code 2 (sid 解決失敗を優先)", () => {
    const d = decideCheckSubscribe("", true, bin);
    expect(d.exitCode).toBe(2);
  });
});
