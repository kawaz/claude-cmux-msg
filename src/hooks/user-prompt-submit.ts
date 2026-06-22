#!/usr/bin/env bun
/**
 * UserPromptSubmit フック
 *
 * ユーザがプロンプトを送信するたびに発火し、cmux-msg の inbox に
 * 未読メッセージがあれば stdout に「新着 N 件」を出す。stdout は
 * 次の Claude ターンに <system-reminder> として injection される。
 *
 * 報告者の好みは「Monitor + cmux-msg subscribe で常時監視」+「UserPromptSubmit
 * で補完チェック」の組み合わせ (docs/issue/2026-05-09-inbox-no-active-notification.md)。
 * このフックは後者を担う。Monitor が張られていなくても次のターン送信時に
 * 気付ける safety net。
 */
import * as fs from "fs";
import * as path from "path";
import { UUID_PATTERN } from "../lib/validate";
import { getMsgBase } from "../lib/paths";
import { transitionState } from "../lib/state";
import { openDb } from "../lib/db";
import { updateState } from "../lib/session-status";
import { detectSubscribeForSid } from "../lib/subscribe-watch";

interface Input {
  session_id: string;
  cwd?: string;
  hook_event_name?: string;
}

function countUnread(inboxDir: string): number {
  if (!fs.existsSync(inboxDir)) return 0;
  return fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md")).length;
}

async function main(): Promise<void> {
  let input: Input;
  try {
    const stdinText = await Bun.stdin.text();
    input = JSON.parse(stdinText);
  } catch {
    process.exit(0);
  }

  // DR-0010 stage 1: 旧 `if (!workspaceId) process.exit(0)` を撤廃。
  // cmux 環境外でも未読 inbox を通知 + state=running 反映する。

  const sessionId = input.session_id;
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    process.exit(0);
  }

  // DR-0004: ユーザ入力 → state を running に遷移
  try {
    transitionState(sessionId, "running");
  } catch {
    // 遷移失敗は致命的ではない (meta 未存在等)
  }

  // DR-0016 stage E: DB sessions.state も並列更新
  try {
    const db = openDb();
    updateState(db, sessionId, "running");
    db.close();
  } catch (e) {
    process.stderr.write(
      `[cmux-msg user-prompt-submit db] ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }

  // DR-0004: dir 構造が `<base>/<sid>/` に変更された
  const inboxDir = path.join(getMsgBase(), sessionId, "inbox");
  const count = countUnread(inboxDir);

  // issue 2026-06-18: SessionStart は `/cd` で発火しないため、subscribe が
  // 落ちても気付けない。UserPromptSubmit 経路でも生存チェックして補完する。
  // 落ちていれば次ターンに <system-reminder> で張り直しを促す。
  const subscribeDetected = detectSubscribeForSid(sessionId);

  const lines: string[] = [];
  if (!subscribeDetected) {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    const cmuxMsgBin = pluginRoot ? `${pluginRoot}/bin/cmux-msg` : "cmux-msg";
    lines.push(
      `[cmux-msg] ⚠️ subscribe が稼働していません (claude の子孫プロセスに未検出)。新着通知に気付けない可能性があります。**Monitor ツールで** \`${cmuxMsgBin} subscribe\` を起動 / 張り直してください。`,
    );
  }
  if (count > 0) {
    lines.push(
      `[cmux-msg] 未読 ${count} 件: \`cmux-msg list\` で確認、\`cmux-msg read <filename>\` で本文取得。`,
    );
  }
  if (lines.length === 0) {
    process.exit(0);
  }
  // stdout は次ターンの <system-reminder> に injection される。
  console.log(lines.join("\n"));
}

main().catch(() => {
  // フックは失敗しても claude のターンを止めない (exit 0)
  process.exit(0);
});
