import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  requireCmux,
  getSessionId,
  getWorkspaceId,
  MSG_BASE,
  SPAWN_COLORS,
  pluginRoot,
  wsDir,
} from "../config";
import {
  cmuxNewSplit,
  cmuxSend,
  cmuxSendKey,
  cmuxReadScreen,
  cmuxRenameTab,
} from "../lib/cmux";
import { validateName, isSessionId, shellSingleQuote } from "../lib/validate";
import { listPeers } from "../lib/peer";

// claude プロンプト検出ポーリング
const PROMPT_POLL_INTERVAL_MS = 2000;
const PROMPT_WAIT_MAX_SEC = 30;
// /color, /rename 等のスラッシュコマンドが claude 側に処理されるまでの待機。
// claude 側に完了 signal が無いため経験則で 1 秒。
const SLASH_COMMAND_SETTLE_MS = 1000;

const LAST_WORKER_FILE = ".last-worker-surface";

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

export async function cmdSpawn(args: string[]): Promise<void> {
  requireCmux();

  let name = "";
  let claudeArgs = "--dangerously-skip-permissions";
  let cwd = "";

  // オプション解析
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--name" && i + 1 < args.length) {
      name = args[i + 1]!;
      i += 2;
    } else if (arg === "--args" && i + 1 < args.length) {
      claudeArgs = args[i + 1]!;
      i += 2;
    } else if (arg === "--cwd" && i + 1 < args.length) {
      cwd = args[i + 1]!;
      i += 2;
    } else {
      // 位置引数: name
      if (!name) {
        name = arg;
      }
      i++;
    }
  }

  // 既存ピアの数からカラーインデックスを決定 (alive/dead 含む全 session)
  const wsDirPath = path.join(MSG_BASE, getWorkspaceId());
  const peerCount = listPeers(wsDirPath).length;

  // 名前未指定なら連番
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
  const msgWsDir = path.join(MSG_BASE, getWorkspaceId());
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

  // 起動待ち（プロンプトの出現を待つ）
  let waited = 0;
  while (waited < PROMPT_WAIT_MAX_SEC) {
    await new Promise((resolve) => setTimeout(resolve, PROMPT_POLL_INTERVAL_MS));
    waited += PROMPT_POLL_INTERVAL_MS / 1000;
    try {
      const screen = await cmuxReadScreen(surfaceRef);
      if (screen.includes("❯") && screen.includes("Claude Code")) {
        break;
      }
    } catch {
      // read-screen 失敗は無視
    }
  }

  if (waited >= PROMPT_WAIT_MAX_SEC) {
    console.error(`警告: Claude起動のタイムアウト (${PROMPT_WAIT_MAX_SEC}秒)`);
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

  // 子の session_id は親が生成した値をそのまま使える（逆引き不要）
  console.log(`spawn完了: id=${childSessionId} name=${name} color=${color}`);
}
