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
import { saveSurfaceRef } from "../lib/surface-refs";
import { SURFACE_REF_PATTERN } from "../lib/validate";

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

  const surfaceId = process.env.CMUX_SURFACE_ID || "";
  const msgBase =
    process.env.CMUX_MSG_BASE ||
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

  // init 共通関数で初期化
  const myDir = path.join(msgBase, workspaceId, surfaceId);
  initWorkspace(myDir);

  // surface:N → UUID マッピングを保存（spawn 経由の場合）
  const surfaceRef = process.env.CMUX_MSG_SURFACE_REF;
  if (surfaceRef && surfaceId && SURFACE_REF_PATTERN.test(surfaceRef)) {
    saveSurfaceRef(surfaceRef, surfaceId);
  }

  // $CLAUDE_ENV_FILE に PATH 追記（cmux-msg を PATH に通す）
  const claudeEnvFile = process.env.CLAUDE_ENV_FILE;
  if (claudeEnvFile && pluginRoot) {
    const binDir = path.join(pluginRoot, "bin");
    const envLine = `export PATH="${binDir}:$PATH"\n`;
    fs.appendFileSync(claudeEnvFile, envLine);
  }

  // コンテキスト出力
  const parentSurface = process.env.CMUX_MSG_PARENT_SURFACE;
  const workerName = process.env.CMUX_MSG_WORKER_NAME;

  if (parentSurface) {
    // ワーカーとして spawn された場合
    console.log(`[cmux-msg:spawned-worker]
parent_surface: ${parentSurface}
worker_name: ${workerName || "unnamed"}
surface_id: ${surfaceId}

あなたは cmux-msg spawn で起動されたワーカーCCです。
このセッションは自動生成されたもので、セッション日誌の作成対象外です。

## メッセージング手順
- cmux-msg list で inbox を確認
- cmux-msg read <file> で内容確認
- 指示に従って作業し cmux-msg reply で返信
- 待機中は次のメッセージを待つ`);
  } else {
    // 通常の場合
    console.log(`[cmux-msg] 初期化済み (surface: ${surfaceId})
cmux-msg コマンドで他のCCとメッセージのやり取りができます。`);
  }
}

main().catch(() => {
  process.exit(0);
});
