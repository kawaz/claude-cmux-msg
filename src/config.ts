import * as path from "path";
import * as os from "os";

export const MSG_BASE =
  process.env.CMUX_MSG_BASE ||
  path.join(os.homedir(), ".local/share/cmux-messages");

export function getWorkspaceId(): string {
  return process.env.CMUX_WORKSPACE_ID || "";
}

/**
 * claude の session UUID。cmux-msg の通信単位。
 * SessionStart hook が CLAUDE_ENV_FILE 経由で export し、以降のシェルで参照可能。
 */
export function getSessionId(): string {
  return process.env.CMUX_MSG_SESSION_ID || "";
}

export function getTabId(): string {
  return process.env.CMUX_TAB_ID || "";
}

export function requireCmux(): void {
  if (!getWorkspaceId()) {
    console.error(
      "エラー: cmux環境外では使えません (CMUX_WORKSPACE_ID が未設定)"
    );
    process.exit(1);
  }
  if (!getSessionId()) {
    console.error(
      "エラー: CMUX_MSG_SESSION_ID が未設定です (SessionStart hook が未実行？)"
    );
    process.exit(1);
  }
}

export function myDir(): string {
  return path.join(MSG_BASE, getWorkspaceId(), getSessionId());
}

export function peerDir(peerSessionId: string): string {
  return path.join(MSG_BASE, getWorkspaceId(), peerSessionId);
}

export function wsDir(): string {
  return path.join(MSG_BASE, getWorkspaceId());
}

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function nowIso(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function pluginRoot(): string {
  // CLAUDE_PLUGIN_ROOT > バイナリの親の親 > cwd のフォールバック
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  // bin/cmux-msg から実行されている場合、bin/ の親がプラグインルート
  const binDir = path.dirname(process.execPath || process.argv[0] || "");
  if (path.basename(binDir) === "bin") return path.dirname(binDir);
  return process.cwd();
}

export const SPAWN_COLORS = [
  "red",
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "cyan",
  "yellow",
] as const;
