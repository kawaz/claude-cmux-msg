import * as path from "path";
import * as os from "os";
import { getMsgBase } from "./lib/paths";
import { GuardError } from "./lib/errors";

// 旧版の `MSG_BASE` 定数は廃止 (import 時固定値で env 切替が反映されない問題)。
// 全箇所で関数版 `getMsgBase()` を経由する。`config.ts` を import している
// 既存箇所は引き続き `getMsgBase` を re-export 経由で利用可能。
export { getMsgBase };

/**
 * claude の session UUID。cmux-msg の通信単位。
 *
 * 解決順序 (DR-0004):
 *   1. env CLAUDE_CODE_SESSION_ID (Claude Code 2.x で Bash 子プロセスに提供される)
 *   2. env CMUXMSG_SESSION_ID (互換 / 手動設定用)
 *   3. 解決不可なら ""
 */
export function getSessionId(): string {
  const fromClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  if (fromClaudeEnv) return fromClaudeEnv;
  const fromEnv = process.env.CMUXMSG_SESSION_ID;
  if (fromEnv) return fromEnv;
  return "";
}

/**
 * Claude アカウントの ~/.claude (CLAUDE_CONFIG_DIR で切替可能)。
 * DR-0004 のグルーピング軸 `--by home` で使う。
 */
export function getClaudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/**
 * session_id が解決できることを要求する (messaging 系コマンド共通ガード)。
 */
export function requireSessionId(): void {
  if (!getSessionId()) {
    throw new GuardError(
      "エラー: session_id を解決できません (env CLAUDE_CODE_SESSION_ID / CMUXMSG_SESSION_ID が未設定。SessionStart hook が未実行？)"
    );
  }
}

/**
 * 自セッションの dir (`<base>/<sid>/`)。
 */
export function myDir(): string {
  return path.join(getMsgBase(), getSessionId());
}

/**
 * peer session の dir (`<base>/<peerSid>/`)。
 */
export function peerDir(peerSessionId: string): string {
  return path.join(getMsgBase(), peerSessionId);
}

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * ISO 8601 形式の現在時刻 (timezone offset 付き)。
 * 例: `2026-05-07T12:34:56+09:00`
 *
 * 旧実装はローカル時刻を timezone なしで書いていたため、`history --json` で
 * 別マシンに渡すと曖昧だった。timezone を含めることで「未来から来たメッセージ」
 * 問題を回避する。
 */
export function nowIso(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offset}`;
}

export function pluginRoot(): string {
  // CLAUDE_PLUGIN_ROOT > argv[1] が src/cli.ts (bun run 起動) > バイナリの親の親 > cwd
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  // bun run src/cli.ts のような起動なら argv[1] が cli.ts のフルパス
  const argv1 = process.argv[1] || "";
  if (argv1.endsWith(`${path.sep}src${path.sep}cli.ts`)) {
    return path.dirname(path.dirname(argv1));
  }
  // bin/ 配下のバイナリから実行されている場合、bin/ の親がプラグインルート
  const binDir = path.dirname(process.execPath || process.argv[0] || "");
  if (path.basename(binDir) === "bin") return path.dirname(binDir);
  // 最終フォールバック: cwd は確実に違う場所のことが多いので警告を出す
  process.stderr.write(
    `[warning] cmux-msg pluginRoot を解決できず cwd (${process.cwd()}) を使います。` +
      `CLAUDE_PLUGIN_ROOT 経由の起動を推奨。\n`
  );
  return process.cwd();
}

