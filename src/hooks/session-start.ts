#!/usr/bin/env bun
/**
 * SessionStart フック
 *
 * stdin から JSON を読み、cmux 環境であれば初期化処理を実行して
 * stdout にコンテキスト情報を出力する。
 *
 * DR-0004: dir 構造が `<base>/<sid>/` (workspace_id 階層なし) に変更された。
 */

import * as fs from "fs";
import * as path from "path";
import { initWorkspace } from "../commands/init";
import { countInbox } from "../lib/inbox";
import { UUID_PATTERN } from "../lib/validate";
import { writeBySurfaceIndex } from "../lib/session-index";
import { cmuxIdentify, cmuxSignal } from "../lib/cmux";
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

  // cmux 環境チェック (= DR-0010 stage 1: 早期 return を廃止)。
  // cmux 環境外 (kawaz の現環境 / hyoui 配下) でも meta.json / DB sessions を作成し、
  // messaging (send/subscribe/read) が動くようにする。
  // workspaceId は cmux signal 通知 (parentSessionId 経由) でのみ使う。
  const workspaceId = process.env.CMUX_WORKSPACE_ID;

  // session_id は claude から必ず渡される前提
  const sessionId = input.session_id;
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    console.error(`[cmux-msg] session_id が不正: ${sessionId}`);
    process.exit(0);
  }

  const msgBase = getMsgBase();

  // cmux-msg は bun で src/cli.ts を直接実行する方式に一本化済み。
  // bin/cmux-msg ラッパーが常に bun 実行するため、コンパイル工程は不要。
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

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

  // init 共通関数で初期化 (DR-0004: workspace_id 階層なし)
  const myDirPath = path.join(msgBase, sessionId);
  initWorkspace(myDirPath, { cwd: input.cwd });

  // DR-0016 stage E: DB sessions に並列書き込み (= 真実源を file から DB へ段階移行)
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

  // spawn 経由で起動された場合、親に「起動完了」を signal で通知する。
  // 親 (spawn コマンド) は cmux wait-for で待機中。
  // 旧実装は親が screen の文字列マッチでポーリングしていたが、Claude Code の
  // 表示文字列バージョン依存だった。signal 駆動のほうが確実。
  //
  // DR-0010 stage 1: cmuxSignal は cmux 必須なので workspaceId 不在時はスキップ。
  // (cmux 環境外で spawn は使えないため parentSessionId が立っていることもないが
  //  安全側で skip)
  if (parentSessionId && workspaceId) {
    try {
      await cmuxSignal(`cmux-msg:spawned-${sessionId}`);
    } catch {
      // signal 失敗は致命的ではない (親は timeout で進む)
    }
  }

  let unreadCount = 0;
  try {
    unreadCount = countInbox();
  } catch {
    // inbox 未初期化なら 0 扱い
  }

  // plugin root の絶対パスを CC に通知して Bash 実行ではこれを使わせる
  // (PATH 経由は古い cache version に当たる事故がある)
  const cmuxMsgBin = pluginRoot
    ? `${pluginRoot}/bin/cmux-msg`
    : "cmux-msg";
  const unreadLine =
    unreadCount > 0
      ? `\n未読メッセージ ${unreadCount} 件: \`${cmuxMsgBin} list\` で確認してください。`
      : "";

  // DR-0007 決定10: 自分の claude の子孫プロセスツリーに subscribe が居るか実検出し、
  // source (startup/resume/clear/compact) と組み合わせて張り直し要否の文言を出す。
  // 実検出を source より優先する (誤検知回避)。
  const subscribeDetected = detectSubscribeForSid(sessionId);
  const subscribeMsg = decideSubscribeMessage(input.source, subscribeDetected);

  if (parentSessionId) {
    console.log(`[cmux-msg:spawned-worker]
parent_session_id: ${parentSessionId}
worker_name: ${workerName || "unnamed"}
session_id: ${sessionId}
cmux_msg_bin: ${cmuxMsgBin}

あなたは cmux-msg spawn で起動されたワーカーCCです。
このセッションは自動生成されたもので、セッション日誌の作成対象外です。

Bash で cmux-msg を叩くときは上の cmux_msg_bin を使うこと (PATH 経由は不可)。

## subscribe (新着通知購読) の状態
${subscribeMsg.text}
subscribe コマンド: \`${cmuxMsgBin} subscribe\` (stdout は JSONL、1 行 = 1 件の新着通知)。
subscribe 起動時は既存未読を全件再通知するため取りこぼし無し。

## メッセージング手順
1. 上記「subscribe の状態」に従い、必要なら **Monitor ツールで** subscribe を起動/張り直す
2. 通知が来たら \`cmux-msg read <filename>\` で本文確認 → 作業実施 → \`cmux-msg reply <file> --text "結果"\` (短文) または \`cmux-msg reply <file> < reply.md\` (長文 stdin) で返信
   - reply は内部で accept してから archive に移すので、別途 \`cmux-msg accept\` は不要
   - 受け取ったが返信不要なメッセージは \`cmux-msg dismiss <filename>\` で archive へ
3. ユーザから停止指示があるまで 2 を繰り返す

## 補助コマンド
- \`cmux-msg history [--peer <id>] [--limit N]\`: 自分が関わった全メッセージを時系列マージ表示（送信は sent/, 受信は inbox/accepted/archive/）
- \`cmux-msg thread <filename>\`: in_reply_to を辿って会話単位で表示
- \`cmux-msg peers --by <axis>|--all\`: peer 一覧 (--by home|ws|cwd|repo|tag:NAME で軸指定。--all で全 alive)${unreadLine}`);
  } else {
    console.log(`[cmux-msg] 初期化済み (session_id: ${sessionId})
cmux_msg_bin: ${cmuxMsgBin}

cmux-msg コマンドで他のCCとメッセージのやり取りができます。Bash で叩くときは上の \`cmux_msg_bin\` を使うこと (PATH 経由は不可)。

## subscribe (新着通知購読) の状態
${subscribeMsg.text}
subscribe コマンド: \`${cmuxMsgBin} subscribe\` (stdout は JSONL、1 行 = 1 件の新着通知)。
これを張らないと新着メッセージに能動的に気付けません (補完として UserPromptSubmit hook が次ターン送信時に未読件数を通知しますが、ターン中は発火しません)。${unreadLine}`);
  }
}

main().catch((e) => {
  // フックの失敗は CC のターンを止めない (exit 0)。
  // ただし spawn-claude-not-launching の調査用にエラー詳細を stderr に出す。
  // claude code は stderr を debug log に流すので、issue 報告時に取得できる。
  // ref: docs/runbooks/spawn-troubleshooting.md
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[cmux-msg session-start hook error] ${msg}\n`);
  process.exit(0);
});
