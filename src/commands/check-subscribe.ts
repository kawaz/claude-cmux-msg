/**
 * check-subscribe: 現セッションの subscribe (Monitor 起動の long-running) が
 * 子孫プロセスツリーに存在するかを判定する (issue 2026-06-22-check-subscribe-subcommand)。
 *
 * justfile push 等の deps に組み込み、subscribe 落ち時に **recipe fail** で
 * AI に強制気付かせる用途を想定。stderr に Monitor 経由の起動コマンドを
 * コピペ可能な形で出力する (= 引数組立余地ゼロ)。
 *
 * exit code:
 *   0  subscribe 起動中 (検出 OK)
 *   1  subscribe 起動なし (recipe fail で AI に気付かせる)
 *   2  sid 解決失敗 (= cmux-msg session 認識不可、recipe 側で握りつぶし判断可)
 */

import { getSessionId, pluginRoot } from "../config";
import { detectSubscribeForSid } from "../lib/subscribe-watch";

export interface CheckSubscribeDecision {
  /** プロセスの exit code として使う値 (0/1/2)。 */
  exitCode: 0 | 1 | 2;
  /** stderr に出すメッセージ。空文字なら出力なし (exitCode=0)。 */
  stderr: string;
}

/**
 * sid 解決結果と検出結果から exit code と stderr 文言を決める純粋関数。
 * pluginBin は subscribe 起動コマンドの絶対パス (CLAUDE_PLUGIN_ROOT/bin/cmux-msg)。
 */
export function decideCheckSubscribe(
  sid: string,
  detected: boolean,
  pluginBin: string,
): CheckSubscribeDecision {
  if (!sid) {
    return {
      exitCode: 2,
      stderr:
        "[check-subscribe] sid を解決できません (CLAUDE_CODE_SESSION_ID / CMUXMSG_SESSION_ID 未設定、SessionStart hook 未走行?)。\n",
    };
  }
  if (detected) {
    return { exitCode: 0, stderr: "" };
  }
  return {
    exitCode: 1,
    stderr:
      "[check-subscribe] ⚠️ subscribe が claude の子孫プロセスに見つかりません。\n" +
      "Monitor ツールで以下のコマンドを persistent: true で起動してください:\n" +
      `  ${pluginBin} subscribe\n` +
      "(stdout は JSONL、1 行 = 1 件の新着通知。Bash で直接叩くとハングします)\n",
  };
}

export function cmdCheckSubscribe(_args: string[]): void {
  const sid = getSessionId();
  const detected = sid ? detectSubscribeForSid(sid) : false;
  const bin = `${pluginRoot()}/bin/cmux-msg`;
  const decision = decideCheckSubscribe(sid, detected, bin);
  if (decision.stderr) process.stderr.write(decision.stderr);
  process.exit(decision.exitCode);
}
