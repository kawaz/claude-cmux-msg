import * as path from "path";
import * as os from "os";

export const MSG_BASE =
  process.env.CMUX_MSG_BASE ||
  path.join(os.homedir(), ".local/share/cmux-messages");

export function getWorkspaceId(): string {
  return process.env.CMUX_WORKSPACE_ID || "";
}

export function getSurfaceId(): string {
  return process.env.CMUX_SURFACE_ID || "";
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
}

export function myDir(): string {
  return path.join(MSG_BASE, getWorkspaceId(), getSurfaceId());
}

export function peerDir(peerSurface: string): string {
  return path.join(MSG_BASE, getWorkspaceId(), peerSurface);
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
