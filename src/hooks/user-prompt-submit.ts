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

  // cmux 環境チェック
  const workspaceId = process.env.CMUX_WORKSPACE_ID;
  if (!workspaceId) {
    process.exit(0);
  }

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

  // DR-0004: dir 構造が `<base>/<sid>/` に変更された
  const inboxDir = path.join(getMsgBase(), sessionId, "inbox");
  const count = countUnread(inboxDir);
  if (count === 0) {
    process.exit(0);
  }

  // stdout は次ターンの <system-reminder> に injection される。
  // 短く、行動を促す形にする。
  console.log(
    `[cmux-msg] 未読 ${count} 件: \`cmux-msg list\` で確認、\`cmux-msg read <filename>\` で本文取得。`
  );
}

main().catch(() => {
  // フックは失敗しても claude のターンを止めない (exit 0)
  process.exit(0);
});
