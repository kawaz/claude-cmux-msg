#!/usr/bin/env bun
/**
 * SessionStart フック
 *
 * stdin から JSON を読み、cmux 環境であれば初期化処理を実行して
 * stdout にコンテキスト情報を出力する。
 */

import * as fs from "fs";
import * as path from "path";
import { initWorkspace } from "../commands/init";
import { countInbox } from "../lib/message";
import { UUID_PATTERN } from "../lib/validate";
import { writeBySurfaceIndex } from "../lib/session-index";
import { cmuxIdentify } from "../lib/cmux";

interface SessionStartInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  source: string;
}

async function main(): Promise<void> {
  // stdin から JSON を読む
  let input: SessionStartInput;
  try {
    const stdinText = await Bun.stdin.text();
    input = JSON.parse(stdinText);
  } catch {
    // JSON パース失敗は静かに終了
    process.exit(0);
  }

  // cmux 環境チェック
  const workspaceId = process.env.CMUX_WORKSPACE_ID;
  if (!workspaceId) {
    process.exit(0);
  }

  // session_id は claude から必ず渡される前提
  const sessionId = input.session_id;
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    console.error(`[cmux-msg] session_id が不正: ${sessionId}`);
    process.exit(0);
  }

  const msgBase =
    process.env.CMUXMSG_BASE ||
    path.join(process.env.HOME || "", ".local/share/cmux-messages");

  // bin/cmux-msg が未ビルドなら自動ビルド
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const binPath = path.join(pluginRoot, "bin", "cmux-msg");
    if (!fs.existsSync(binPath)) {
      try {
        Bun.spawnSync(["bun", "run", "build"], {
          cwd: pluginRoot,
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch {
        // ビルド失敗は無視（bun run で動作可能）
      }
    }
  }

  // initWorkspace/countInbox が getSessionId() 経由で env を読むので先に設定
  process.env.CMUXMSG_SESSION_ID = sessionId;

  // surface_ref は spawn 経由なら env で渡されるが、親セッション等では未設定。
  // その場合は cmux identify で取得して env に詰める（initWorkspace が読む）。
  const surfaceId = process.env.CMUX_SURFACE_ID;
  if (!process.env.CMUXMSG_SURFACE_REF && surfaceId) {
    try {
      const ident = await cmuxIdentify(surfaceId);
      if (ident.surfaceRef) {
        process.env.CMUXMSG_SURFACE_REF = ident.surfaceRef;
      }
    } catch {
      // identify 失敗時は surface_ref 無しで続行（tell/screen/stop が使えないだけ）
    }
  }

  // init 共通関数で初期化
  const myDirPath = path.join(msgBase, workspaceId, sessionId);
  initWorkspace(myDirPath);

  // CMUX_SURFACE_ID → session_id の lookup index を書く。
  // CLAUDE_ENV_FILE 経由の env 伝播が claude-code Issue #15840 で動かないため、
  // 各 cmux-msg コマンドはこの index を経由して session_id を解決する。
  if (surfaceId) {
    try {
      writeBySurfaceIndex(surfaceId, sessionId);
    } catch {
      // 書き込み失敗時は cmux-msg コマンドが動かなくなるが hook 自体は続行
    }
  }

  // $CLAUDE_ENV_FILE に PATH と CMUXMSG_SESSION_ID を export しておく。
  // 現状 claude-code 側の Issue #15840 で動かないが、修正された日のために残しておく。
  // PATH の export は新セッションでログインシェルが読むケースで効くこともあり害がない。
  const claudeEnvFile = process.env.CLAUDE_ENV_FILE;
  if (claudeEnvFile) {
    const lines: string[] = [];
    if (pluginRoot) {
      const binDir = path.join(pluginRoot, "bin");
      lines.push(`export PATH="${binDir}:$PATH"`);
    }
    lines.push(`export CMUXMSG_SESSION_ID=${sessionId}`);
    fs.appendFileSync(claudeEnvFile, lines.join("\n") + "\n");
  }

  // コンテキスト出力
  const parentSessionId = process.env.CMUXMSG_PARENT_SESSION_ID;
  const workerName = process.env.CMUXMSG_WORKER_NAME;

  let unreadCount = 0;
  try {
    unreadCount = countInbox();
  } catch {
    // inbox 未初期化なら 0 扱い
  }
  const unreadLine =
    unreadCount > 0
      ? `\n未読メッセージ ${unreadCount} 件: \`cmux-msg list\` で確認してください。`
      : "";

  if (parentSessionId) {
    console.log(`[cmux-msg:spawned-worker]
parent_session_id: ${parentSessionId}
worker_name: ${workerName || "unnamed"}
session_id: ${sessionId}

あなたは cmux-msg spawn で起動されたワーカーCCです。
このセッションは自動生成されたもので、セッション日誌の作成対象外です。

## メッセージング手順
1. セッション開始直後に Monitor ツールで \`cmux-msg subscribe\` を張る（persistent: true 推奨）
   - stdout は JSONL。1行 = 1件の未読メッセージ通知
2. 通知が来たら \`cmux-msg read <filename>\` で本文確認 → 作業実施 → \`cmux-msg reply <file> "結果"\` で返信
3. セッションが resume された場合も同じく Monitor を張り直す
   - subscribe 起動時に既存未読を全件再通知するため取りこぼし無し
4. ユーザから停止指示があるまで 2 を繰り返す${unreadLine}`);
  } else {
    console.log(`[cmux-msg] 初期化済み (session_id: ${sessionId})
cmux-msg コマンドで他のCCとメッセージのやり取りができます。
新着監視は Monitor ツール + \`cmux-msg subscribe\` を推奨（JSONL 出力、1行 = 1件の新着通知）。${unreadLine}`);
  }
}

main().catch(() => {
  process.exit(0);
});
