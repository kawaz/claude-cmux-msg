#!/usr/bin/env bun
/**
 * SessionStart フック
 *
 * stdin から JSON を読み、cmux-msg の受信箱 / DB sessions を初期化して
 * stdout にコンテキスト情報を出力する。
 *
 * cmux 依存はゼロ (DR-0010 stage 2 完結)。任意の起動形態の claude セッションで動作する。
 */

import * as fs from "fs";
import * as path from "path";
import { initWorkspace } from "../commands/init";
import { countInbox } from "../lib/inbox";
import { UUID_PATTERN } from "../lib/validate";
import { getMsgBase } from "../lib/paths";
import {
  detectSubscribeForSid,
  decideSubscribeMessage,
} from "../lib/subscribe-watch";
import { openDb } from "../lib/db";
import { upsertSession, addLabels } from "../lib/session-status";
import { computeScopeHashes } from "../lib/scope-hash";
import { parseLabels } from "../lib/label-parser";
import { lookupSidProcess } from "../lib/session-proc";

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

  // session_id は claude から必ず渡される前提
  const sessionId = input.session_id;
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    console.error(`[cmux-msg] session_id が不正: ${sessionId}`);
    process.exit(0);
  }

  const msgBase = getMsgBase();
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

  // initWorkspace/countInbox が getSessionId() 経由で env を読むので先に設定
  process.env.CMUXMSG_SESSION_ID = sessionId;

  // 受信箱と meta.json を初期化
  const myDirPath = path.join(msgBase, sessionId);
  initWorkspace(myDirPath, { cwd: input.cwd });

  // DB sessions に並列書き込み (= 真実源を file から DB へ段階移行、DR-0016 stage E)。
  // 既存 meta.json は維持 (= 後方互換)、DB 書き込み失敗は silent (= 既存動作を壊さない)
  try {
    const db = openDb();
    const scopes = computeScopeHashes(input.cwd);
    const lookup = lookupSidProcess(sessionId);
    const claudePid = lookup.kind === "found" ? lookup.pid : process.ppid;
    const home =
      process.env.CLAUDE_CONFIG_DIR || process.env.HOME || "/";
    const now = Date.now();
    upsertSession(db, {
      sid: sessionId,
      home,
      cwd: scopes.cwd,
      cwdHash: scopes.cwdHash,
      ws: scopes.ws,
      wsHash: scopes.wsHash,
      repo: scopes.repo,
      repoHash: scopes.repoHash,
      state: "idle",
      pid: claudePid,
      startedAt: now,
      lastSeen: now,
      metaJson: null,
    });
    // labels: 新 CCMSG_LABELS env、旧 CMUXMSG_TAGS env も互換受付 (DR-0013)
    const labelsCsv =
      process.env.CCMSG_LABELS ?? process.env.CMUXMSG_TAGS ?? "";
    if (labelsCsv.trim().length > 0) {
      try {
        const labels = parseLabels(labelsCsv);
        if (labels.length > 0) addLabels(db, sessionId, labels);
      } catch {
        // 不正な label 値は silent skip (= hook 自体を止めない)
      }
    }
    db.close();
  } catch (e) {
    // DB 書き込み失敗は stderr に出すが hook は続行 (= 既存 meta.json 経路は生きている)
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[cmux-msg session-start db] ${msg}\n`);
  }

  // $CLAUDE_ENV_FILE に PATH と CMUXMSG_SESSION_ID を export する。
  // Claude Code 側で読まれて Bash 子プロセスに渡る経路。
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

  let unreadCount = 0;
  try {
    unreadCount = countInbox();
  } catch {
    // inbox 未初期化なら 0 扱い
  }

  // plugin root の絶対パスを CC に通知して Bash 実行ではこれを使わせる
  // (PATH 経由は古い cache version に当たる事故がある)
  const cmuxMsgBin = pluginRoot ? `${pluginRoot}/bin/cmux-msg` : "cmux-msg";
  const unreadLine =
    unreadCount > 0
      ? `\n未読メッセージ ${unreadCount} 件: \`${cmuxMsgBin} list\` で確認してください。`
      : "";

  // 自分の claude の子孫プロセスツリーに subscribe が居るか実検出し、
  // source (startup/resume/clear/compact) と組み合わせて張り直し要否の文言を出す。
  const subscribeDetected = detectSubscribeForSid(sessionId);
  const subscribeMsg = decideSubscribeMessage(input.source, subscribeDetected);

  console.log(`[cmux-msg] 初期化済み (session_id: ${sessionId})
cmux_msg_bin: ${cmuxMsgBin}

cmux-msg コマンドで他のCCとメッセージのやり取りができます。Bash で叩くときは上の \`cmux_msg_bin\` を使うこと (PATH 経由は不可)。

## subscribe (新着通知購読) の状態
${subscribeMsg.text}
subscribe コマンド: \`${cmuxMsgBin} subscribe\` (stdout は JSONL、1 行 = 1 件の新着通知)。
これを張らないと新着メッセージに能動的に気付けません (補完として UserPromptSubmit hook が次ターン送信時に未読件数を通知しますが、ターン中は発火しません)。${unreadLine}`);
}

main().catch((e) => {
  // フックの失敗は CC のターンを止めない (exit 0)。
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[cmux-msg session-start hook error] ${msg}\n`);
  process.exit(0);
});
