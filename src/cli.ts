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
import { cmdWatch } from "./commands/watch";
import { cmdSpawn } from "./commands/spawn";
import { cmdStop } from "./commands/stop";
import { cmdTell } from "./commands/tell";
import { cmdScreen } from "./commands/screen";

const HELP = `cmux-msg: cmux CC間メッセージングシステム

ライフサイクル管理:
  cmux-msg spawn [name] [--dir right|down] [--args claude-args]  子CC起動 (色は自動ローテーション)
  cmux-msg stop <surface_ref>               子CCを終了してペインを閉じる

メッセージング:
  cmux-msg init                  メッセージディレクトリを初期化
  cmux-msg whoami                自分のID情報を表示
  cmux-msg peers                 同一ワークスペースのピア一覧
  cmux-msg send <surface_id> <メッセージ>  メッセージ送信
  cmux-msg broadcast <メッセージ>          全ピアにブロードキャスト
  cmux-msg list                  inbox のメッセージ一覧
  cmux-msg read <filename>       メッセージ内容を表示
  cmux-msg accept <filename>     メッセージを受理 (→ accepted/)
  cmux-msg dismiss <filename>    メッセージを破棄 (→ archive/)
  cmux-msg reply <filename> <返信内容>  返信送信 & アーカイブ
  cmux-msg watch [timeout]       inbox監視 (wait-forベース、デフォルト60秒)

ダイレクト操作:
  cmux-msg tell <surface_ref> <テキスト>   対象に直接テキスト入力
  cmux-msg screen [surface_ref]            画面内容を読み取り

環境変数:
  CMUX_MSG_PRIORITY=urgent  緊急メッセージとして送信
  CMUX_MSG_BASE=<path>      メッセージ保存先 (デフォルト: ~/.local/share/cmux-messages)`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";
  const rest = args.slice(1);

  switch (cmd) {
    case "init":
      cmdInit();
      break;
    case "whoami":
      cmdWhoami();
      break;
    case "ls-peers":
    case "peers":
      cmdPeers();
      break;
    case "send":
      await cmdSend(rest);
      break;
    case "list":
    case "ls":
      cmdList();
      break;
    case "read":
      cmdRead(rest);
      break;
    case "accept":
      cmdAccept(rest);
      break;
    case "dismiss":
      cmdDismiss(rest);
      break;
    case "reply":
      await cmdReply(rest);
      break;
    case "broadcast":
      await cmdBroadcast(rest);
      break;
    case "watch":
      await cmdWatch(rest);
      break;
    case "spawn":
      await cmdSpawn(rest);
      break;
    case "stop":
      await cmdStop(rest);
      break;
    case "tell":
      await cmdTell(rest);
      break;
    case "screen":
      await cmdScreen(rest);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`不明なコマンド: ${cmd}`);
      console.error("cmux-msg help でヘルプを表示");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`エラー: ${e.message || e}`);
  process.exit(1);
});
