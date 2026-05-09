import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  requireCmux,
  getSessionId,
  getWorkspaceId,
  getMsgBase,
  SPAWN_COLORS,
  pluginRoot,
  wsDir,
} from "../config";
import {
  cmuxNewSplit,
  cmuxSend,
  cmuxSendKey,
  cmuxRenameTab,
  cmuxReadScreen,
  cmuxWaitFor,
} from "../lib/cmux";
import { validateName, isSessionId, shellSingleQuote } from "../lib/validate";
import { listPeers } from "../lib/peer";
import { UsageError } from "../lib/errors";

// 子CC の SessionStart hook が `cmux-msg:spawned-<sid>` を signal するまで待つ。
const SPAWN_READY_TIMEOUT_SEC = 30;
// /color, /rename 等のスラッシュコマンドが claude 側に処理されるまでの待機。
// claude 側に完了 signal が無いため経験則で 1 秒。
const SLASH_COMMAND_SETTLE_MS = 1000;

const LAST_WORKER_FILE = ".last-worker-surface";

const SPAWN_HELP = `使い方: cmux-msg spawn <name> [--cwd <path>] [--args <claude-args>] [--json]

子CC を起動して inbox 等のメッセージング初期化を行う。
SessionStart hook が起動完了を signal で親に通知し、親はそれを検知して spawn 完了を出力する。

引数:
  <name>           子CC の名前 (英数字 / '_' / '-' のみ)。位置引数または --name で指定。

オプション:
  --cwd <path>     子CC の cwd (claude プロセス起動時の cd 先)
  --args <args>    claude に渡す追加引数 (デフォルト: --dangerously-skip-permissions)
  --name <name>    子CC の名前 (位置引数の代わり)
  --json           {id, name, color, surface_ref, remote_url} の JSON 1 行で出力
  --help           このヘルプを表示

出力には子CC の Claude Code リモート操作 URL (https://claude.ai/code/session_XXX) を含む。
URL は spawn 後に画面サンプリングで取得する (取れなければ "(取得できませんでした)" / json では null)。

注意:
  - 引数なしで実行すると副作用なくヘルプを表示します (誤発火防止)。
  - --help は最優先で処理され、session は起動されません。
  - 不明なフラグはエラーになります。`;

async function createWorkerSurface(): Promise<string> {
  const lastWorkerFile = path.join(wsDir(), LAST_WORKER_FILE);

  // 前回の子CCのsurface refを読む
  let lastSurface = "";
  try {
    lastSurface = fs.readFileSync(lastWorkerFile, "utf-8").trim();
  } catch {}

  let result: string;

  if (lastSurface) {
    // 既存の子CCがいる → その右に split
    try {
      result = await cmuxNewSplit("right", { surface: lastSurface });
    } catch {
      // 既存surfaceが消えてたら上方向に新規作成
      result = await cmuxNewSplit("up");
    }
  } else {
    // 初回 → 親の上に split（親の位置が動かない）
    result = await cmuxNewSplit("up");
  }

  const surfaceMatch = result.match(/surface:\d+/);
  const surfaceRef = surfaceMatch ? surfaceMatch[0] : "";

  // 最新の子CCのsurface refを記録
  if (surfaceRef) {
    fs.mkdirSync(path.dirname(lastWorkerFile), { recursive: true });
    fs.writeFileSync(lastWorkerFile, surfaceRef);
  }

  return surfaceRef;
}

export interface ParsedSpawnArgs {
  /** ヘルプ表示モードなら true (起動はしない) */
  help: boolean;
  /** name の明示指定 (--name / 位置引数)。未指定なら undefined。 */
  name?: string;
  /** --args の値 (claude プロセスへの追加引数) */
  claudeArgs: string;
  /** --cwd の値 (claude プロセスの cwd) */
  cwd: string;
  /** --json で構造化出力 */
  json: boolean;
}

const KNOWN_VALUE_FLAGS = new Set(["--name", "--args", "--cwd"]);

export function parseSpawnArgs(args: string[]): ParsedSpawnArgs {
  // 引数なしは副作用なくヘルプ表示 (案 B、誤発火防止)
  if (args.length === 0) {
    return {
      help: true,
      claudeArgs: "--dangerously-skip-permissions",
      cwd: "",
      json: false,
    };
  }

  let name: string | undefined;
  let claudeArgs = "--dangerously-skip-permissions";
  let cwd = "";
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    // ヘルプは最優先で処理
    if (arg === "--help") {
      return { help: true, claudeArgs, cwd, json };
    }

    // bool フラグ
    if (arg === "--json") {
      json = true;
      continue;
    }

    // 値を取るフラグ
    if (KNOWN_VALUE_FLAGS.has(arg)) {
      const v = args[i + 1];
      if (v === undefined) {
        throw new UsageError(`${arg} には値が必要です\n\n${SPAWN_HELP}`);
      }
      if (arg === "--name") {
        if (name !== undefined) {
          throw new UsageError(`name が複数指定されています\n\n${SPAWN_HELP}`);
        }
        name = v;
      } else if (arg === "--args") {
        claudeArgs = v;
      } else if (arg === "--cwd") {
        cwd = v;
      }
      i++;
      continue;
    }

    // --foo=bar 形式 (--name=foo / --args=... / --cwd=...)
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      const key = arg.slice(0, eq);
      const val = arg.slice(eq + 1);
      if (KNOWN_VALUE_FLAGS.has(key)) {
        if (key === "--name") {
          if (name !== undefined) {
            throw new UsageError(`name が複数指定されています\n\n${SPAWN_HELP}`);
          }
          name = val;
        } else if (key === "--args") {
          claudeArgs = val;
        } else if (key === "--cwd") {
          cwd = val;
        }
        continue;
      }
      throw new UsageError(`不明なフラグ: ${key}\n\n${SPAWN_HELP}`);
    }

    // 不明なオプション (`-` で始まる) はエラーにする (name として誤消費しない)
    if (arg.startsWith("-")) {
      throw new UsageError(`不明なフラグ: ${arg}\n\n${SPAWN_HELP}`);
    }

    // 位置引数: name (最初の non-option 引数のみ採用、二度目以降はエラー)
    if (name === undefined) {
      name = arg;
    } else {
      throw new UsageError(
        `name が複数指定されています: ${name}, ${arg}\n\n${SPAWN_HELP}`
      );
    }
  }

  return { help: false, name, claudeArgs, cwd, json };
}

/**
 * Claude Code が画面に出す `https://claude.ai/code/session_XXX` の URL を抽出する。
 * 子 CC の TUI ステータスバーに表示されるため、screen の文字列ダンプから正規表現で拾う。
 *
 * Design rationale: Claude Code 側に「remote URL を返す hook / API」が存在しないため、
 * spawn 時に画面サンプリングする heuristic を採用。レイアウト変更で URL 行の位置が
 * 変わっても、URL 自体のパターンは安定しているため正規表現で取れる前提。
 */
export const REMOTE_URL_PATTERN =
  /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/;

export function findRemoteUrl(screenText: string): string | undefined {
  const m = screenText.match(REMOTE_URL_PATTERN);
  return m ? m[0] : undefined;
}

async function pollRemoteUrl(
  surfaceRef: string,
  options: { maxAttempts: number; intervalMs: number }
): Promise<string | undefined> {
  for (let i = 0; i < options.maxAttempts; i++) {
    try {
      const screen = await cmuxReadScreen(surfaceRef);
      const url = findRemoteUrl(screen);
      if (url) return url;
    } catch {
      // 読み取り失敗は無視して次のサンプルへ
    }
    if (i < options.maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, options.intervalMs));
    }
  }
  return undefined;
}

export async function cmdSpawn(args: string[]): Promise<void> {
  const parsed = parseSpawnArgs(args);
  if (parsed.help) {
    console.log(SPAWN_HELP);
    return;
  }

  requireCmux();

  let name = parsed.name ?? "";
  const claudeArgs = parsed.claudeArgs;
  const cwd = parsed.cwd;

  // 既存ピアの数からカラーインデックスを決定 (alive/dead 含む全 session)
  const wsDirPath = path.join(getMsgBase(), getWorkspaceId());
  const peerCount = listPeers(wsDirPath).length;

  // 名前未指定なら連番 (--cwd / --args のみ指定時の補完)
  if (!name) {
    name = `worker-${peerCount + 1}`;
  }
  validateName(name);

  // 色をローテーション
  const color = SPAWN_COLORS[peerCount % SPAWN_COLORS.length]!;

  // ワーカーsurface作成（初回: 上にsplit、以降: 最後の子の右にsplit）
  let surfaceRef: string;
  try {
    surfaceRef = await createWorkerSurface();
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }

  if (!surfaceRef) {
    console.error(`エラー: surface ref が取得できませんでした`);
    process.exit(1);
  }

  // 子 session の UUID を親が先行生成（claude --session-id で採番）
  // これにより spawn は子の起動完了を待たずに子の識別子を確定できる
  const childSessionId = randomUUID();

  const parentSessionId = getSessionId();

  // claude 起動 (環境変数で親子関係を伝達、SessionStartフックが検出する)
  //
  // セキュリティ: cmuxSend はテキストをそのまま shell に流し込むため、各値を
  // shellSingleQuote で囲む。validateName でホワイトリスト済みの name でも
  // 防衛的に quote する。cwd / pluginRoot / surfaceRef / childSessionId も同様。
  //
  // ただし claudeArgs はユーザがオプションを意図的に展開して渡す場所なので
  // **quote しない**。`--args 'foo; rm'` のような任意コードはユーザの責任で
  // 渡すこと (個人プロジェクトの自分用ツールという脅威モデル)。
  //
  // --add-dir で MSG_BASE/<workspace> を子CCのサンドボックスに明示的に許可
  // (子CCの cwd 配下外への書き込みは Claude Code のサンドボックスで拒否されるため、
  //  cmux-msg 用ディレクトリを明示しないと reply / accept / send が EPERM になる)
  const root = pluginRoot();
  const cdPrefix = cwd ? `cd ${shellSingleQuote(cwd)} && ` : "";
  const msgWsDir = path.join(getMsgBase(), getWorkspaceId());
  const claudeCmd =
    `${cdPrefix}` +
    `CMUX_CLAUDE_HOOKS_DISABLED=1 ` +
    `CMUXMSG_PARENT_SESSION_ID=${shellSingleQuote(parentSessionId)} ` +
    `CMUXMSG_WORKER_NAME=${shellSingleQuote(name)} ` +
    `CMUXMSG_SURFACE_REF=${shellSingleQuote(surfaceRef)} ` +
    `claude --session-id ${shellSingleQuote(childSessionId)} ${claudeArgs} ` +
    `--add-dir ${shellSingleQuote(msgWsDir)} ` +
    `--plugin-dir ${shellSingleQuote(root)} ` +
    `--name ${shellSingleQuote(name)}`;
  await cmuxSend(surfaceRef, claudeCmd);
  await cmuxSendKey(surfaceRef, "Return");

  // 起動待ち: 子CC の SessionStart hook が `cmux-msg:spawned-<sid>` を発信するまで待つ。
  // 旧実装は cmuxReadScreen で `❯` + `Claude Code` 文字列をポーリングしていたが、
  // Claude Code のバージョンで表示文字列が変わると壊れる脆さがあった。
  // signal 駆動なら子CC 側で確実に「起動完了」を発信できる。
  const readyResult = await cmuxWaitFor(
    `cmux-msg:spawned-${childSessionId}`,
    SPAWN_READY_TIMEOUT_SEC
  );
  if (readyResult.kind === "timeout") {
    console.error(
      `警告: Claude起動の signal を受信できず (${SPAWN_READY_TIMEOUT_SEC}秒タイムアウト)\n` +
        `  - 子CC のペインを直接見て初期化が走ったか確認してください\n` +
        `  - peer 一覧: cmux-msg peers --all\n` +
        `  - 取り残された session があれば cmux-msg gc --force で掃除\n` +
        `  - 詳細: docs/runbooks/spawn-troubleshooting.md`
    );
  } else if (readyResult.kind === "error") {
    console.error(
      `警告: cmux wait-for エラー (exit=${readyResult.exitCode}): ${readyResult.stderr || ""}`
    );
  }

  // タブタイトル設定
  try {
    await cmuxRenameTab(surfaceRef, name);
  } catch {
    // rename 失敗は無視
  }

  // CC内の色設定
  await cmuxSend(surfaceRef, `/color ${color}`);
  await cmuxSendKey(surfaceRef, "Return");
  await new Promise((resolve) => setTimeout(resolve, SLASH_COMMAND_SETTLE_MS));

  // CC内の名前設定
  await cmuxSend(surfaceRef, `/rename ${name}`);
  await cmuxSendKey(surfaceRef, "Return");
  await new Promise((resolve) => setTimeout(resolve, SLASH_COMMAND_SETTLE_MS));

  // SessionStartフックが自動で init + コンテキスト注入済み。inbox確認のトリガーだけ送る
  await cmuxSend(surfaceRef, "inbox を確認してください");
  await cmuxSendKey(surfaceRef, "Return");

  // remote URL を screen サンプリングで取得 (取れなくても spawn 自体は成功扱い)
  const remoteUrl = await pollRemoteUrl(surfaceRef, {
    maxAttempts: 10,
    intervalMs: 500,
  });

  // 子の session_id は親が生成した値をそのまま使える（逆引き不要）
  if (parsed.json) {
    process.stdout.write(
      JSON.stringify({
        id: childSessionId,
        name,
        color,
        surface_ref: surfaceRef,
        remote_url: remoteUrl ?? null,
      }) + "\n"
    );
  } else {
    console.log("spawn完了:");
    console.log(`  id:      ${childSessionId}`);
    console.log(`  name:    ${name}`);
    console.log(`  color:   ${color}`);
    console.log(`  surface: ${surfaceRef}`);
    if (remoteUrl) {
      console.log(`  remote:  ${remoteUrl}`);
    } else {
      console.log(`  remote:  (取得できませんでした)`);
    }
  }
}
