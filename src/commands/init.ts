import * as fs from "fs";
import * as path from "path";
import {
  requireCmux,
  myDir,
  getSessionId,
  getWorkspaceId,
  getTabId,
  nowIso,
  pluginRoot,
  MSG_BASE,
} from "../config";
import { setupLayoutDocs } from "../lib/layout-docs";
import { formatPidFile } from "../lib/peer";

/**
 * ワークスペース初期化（共通処理）
 * session-start.ts からも呼ばれる
 */
export function initWorkspace(dir: string): void {
  for (const sub of ["inbox", "accepted", "archive", "sent", "tmp"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  // シェルの PID + 起動時刻を記録して生存確認に使う。
  // PID 単独だと再利用で誤判定するため lstart も併記する (formatPidFile)
  const shellPid = process.ppid || process.pid;
  fs.writeFileSync(path.join(dir, "pid"), formatPidFile(shellPid));

  // メタ情報（undefined は JSON.stringify で自動除去）
  const meta = {
    session_id: getSessionId(),
    workspace_id: getWorkspaceId(),
    tab_id: getTabId(),
    surface_id: process.env.CMUX_SURFACE_ID || undefined,
    init_at: nowIso(),
    shell_pid: shellPid,
    worker_name: process.env.CMUXMSG_WORKER_NAME || undefined,
    parent_session_id: process.env.CMUXMSG_PARENT_SESSION_ID || undefined,
    surface_ref: process.env.CMUXMSG_SURFACE_REF || undefined,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  // 各階層に「ここは何の場所か」を示す README.md (symlink) を貼る
  // 失敗してもメッセージング機能には影響しないため例外は投げない
  setupLayoutDocs({
    msgBase: MSG_BASE,
    pluginRoot: pluginRoot(),
    workspaceId: getWorkspaceId(),
    sessionId: getSessionId(),
    version: getPluginVersion(),
  });
}

function getPluginVersion(): string {
  try {
    const pkgPath = path.join(pluginRoot(), ".claude-plugin", "plugin.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

export function cmdInit(): void {
  requireCmux();

  const dir = myDir();
  initWorkspace(dir);

  console.log(`初期化完了: ${dir}`);
}
