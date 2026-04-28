import * as path from "path";
import * as os from "os";
import { readBySurfaceIndex } from "./lib/session-index";

export const MSG_BASE =
  process.env.CMUXMSG_BASE ||
  path.join(os.homedir(), ".local/share/cmux-messages");

export function getWorkspaceId(): string {
  return process.env.CMUX_WORKSPACE_ID || "";
}

/**
 * claude の session UUID。cmux-msg の通信単位。
 *
 * 解決順序:
 *   1. env CMUXMSG_SESSION_ID (将来 CLAUDE_ENV_FILE が機能した時 / 手動設定用)
 *   2. CMUX_SURFACE_ID 起点で by-surface index から逆引き
 *      (SessionStart hook が CLAUDE_ENV_FILE バグ Issue #15840 を回避するため
 *       <ws>/by-surface/<surface_id> に session_id を書いている)
 *   3. 解決不可なら ""
 */
export function getSessionId(): string {
  const fromEnv = process.env.CMUXMSG_SESSION_ID;
  if (fromEnv) return fromEnv;
  const surfaceId = process.env.CMUX_SURFACE_ID;
  if (surfaceId) {
    const found = readBySurfaceIndex(surfaceId);
    if (found) return found;
  }
  return "";
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
      "エラー: session_id を解決できません (env CMUXMSG_SESSION_ID も by-surface index も無い。SessionStart hook が未実行？)"
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
