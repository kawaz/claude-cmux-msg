#!/usr/bin/env bun
/**
 * cmux-msg: cmux CC間ファイルベースメッセージングシステム
 */

import { cmdInit } from "./commands/init";
import { cmdWhoami } from "./commands/whoami";
import { cmdPeers } from "./commands/peers";
import { cmdSend } from "./commands/send";
import { cmdList } from "./commands/list";
import { cmdRead } from "./commands/read";
import { cmdAccept } from "./commands/accept";
import { cmdDismiss } from "./commands/dismiss";
import { cmdReply } from "./commands/reply";
import { cmdBroadcast } from "./commands/broadcast";
import { cmdSubscribe } from "./commands/subscribe";
import { cmdSpawn } from "./commands/spawn";
import { cmdStop } from "./commands/stop";
import { cmdTell } from "./commands/tell";
import { cmdScreen } from "./commands/screen";
import { cmdHistory } from "./commands/history";
import { cmdThread } from "./commands/thread";
import { cmdGc } from "./commands/gc";
import { UsageError } from "./lib/errors";

const HELP = `cmux-msg: cmux CC間メッセージングシステム (DR-0004)

識別子: 全コマンドの宛先は <session_id> = claude --session-id の UUID。
spawn 経由または手動で claude --session-id <uuid> 起動された CC 間で通信。
受信箱は <CMUXMSG_BASE>/<sid>/ に sid 直接化 (workspace 階層なし)。

ライフサイクル管理:
  cmux-msg spawn [name] [--cwd path] [--args claude-args] [--tags csv]  子CC起動 (色は自動ローテーション)
  cmux-msg stop <session_id>     子CCを終了してペインを閉じる

メッセージング:
  cmux-msg init                  メッセージディレクトリを初期化
  cmux-msg whoami                自分のID情報を表示
  cmux-msg peers (--by <axis>... | --all) [--include-dead]
                                 軸明示で peer 一覧 (home/ws/cwd/repo/tag:NAME、AND 結合)。--all で全 alive
  cmux-msg send <session_id> <メッセージ>      永続配送 (state を問わない)
  cmux-msg broadcast (--by <axis>... | --all) <メッセージ>
                                 軸明示でブロードキャスト。軸なしは error
  cmux-msg list                  inbox のメッセージ一覧
  cmux-msg read <filename>       メッセージ内容を表示
  cmux-msg accept <filename>     メッセージを受理 (→ accepted/)
  cmux-msg dismiss <filename>    メッセージを破棄 (→ archive/)
  cmux-msg reply <filename> <返信内容>  返信送信 & アーカイブ
  cmux-msg subscribe             inbox 新着を JSONL で stdout に連続出力 (Monitor 用)
  cmux-msg history [--peer <id>] [--limit N] [--json]  自分が関わった全メッセージを時系列表示
  cmux-msg thread <filename> [--json]  in_reply_to を辿って会話単位で表示
  cmux-msg gc [--force] [--verbose]  inbox/accepted が空の dead セッションを掃除 (既定 dry-run)

ダイレクト操作 (安全境界あり):
  cmux-msg tell <session_id> <テキスト>  fg + state ∈ {idle, awaiting_permission} 必須
  cmux-msg screen [session_id]           fg 必須 (引数なしは自分の surface を読む、制約なし)

環境変数:
  CLAUDE_CODE_SESSION_ID   自セッションの UUID (Claude Code 2.x が提供、最優先)
  CMUXMSG_SESSION_ID       上記の互換 / 手動指定用
  CMUXMSG_PRIORITY=urgent  緊急メッセージとして送信
  CMUXMSG_TAGS=<csv>       自セッションのタグ (init 時に meta.tags へ反映)
  CMUXMSG_BASE=<path>      メッセージ保存先 (デフォルト: ~/.local/share/cmux-messages)`;

type CmdHandler = (args: string[]) => void | Promise<void>;

/**
 * サブコマンド名 → ハンドラのテーブル。
 * alias は同じハンドラを別キーで参照させる (重複ロジックなし)。
 * ヘルプ生成 / 補完 (completions/_cmux-msg) もこのテーブルから派生させたいが
 * 補完は zsh 側で別管理 (動的生成すると初回ロードが遅くなるため)。
 */
const COMMANDS: Record<string, CmdHandler> = {
  init: () => cmdInit(),
  whoami: () => cmdWhoami(),
  peers: cmdPeers,
  "ls-peers": cmdPeers, // alias
  send: cmdSend,
  list: () => cmdList(),
  ls: () => cmdList(), // alias
  read: cmdRead,
  accept: cmdAccept,
  dismiss: cmdDismiss,
  reply: cmdReply,
  broadcast: cmdBroadcast,
  subscribe: cmdSubscribe,
  spawn: cmdSpawn,
  stop: cmdStop,
  tell: cmdTell,
  screen: cmdScreen,
  history: cmdHistory,
  thread: cmdThread,
  gc: cmdGc,
};

const HELP_KEYS = new Set(["help", "--help"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";
  const rest = args.slice(1);

  if (HELP_KEYS.has(cmd)) {
    console.log(HELP);
    return;
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error(`不明なコマンド: ${cmd}`);
    console.error("cmux-msg help でヘルプを表示");
    process.exit(1);
  }
  await handler(rest);
}

main().catch((e) => {
  // UsageError は usage 文をそのまま表示 (「エラー:」プレフィックスなし)
  if (e instanceof UsageError) {
    console.error(e.message);
  } else {
    console.error(`エラー: ${e?.message || e}`);
  }
  process.exit(1);
});
