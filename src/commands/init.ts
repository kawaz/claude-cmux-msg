import * as fs from "fs";
import * as path from "path";
import {
  requireCmux,
  myDir,
  getSessionId,
  getWorkspaceId,
  getTabId,
  nowIso,
} from "../config";

/**
 * ワークスペース初期化（共通処理）
 * session-start.ts からも呼ばれる
 */
export function initWorkspace(dir: string): void {
  for (const sub of ["inbox", "accepted", "archive", "tmp"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  // シェルの PID を記録して生存確認に使う
  const shellPid = process.ppid || process.pid;
  fs.writeFileSync(path.join(dir, "pid"), String(shellPid));

  // メタ情報（undefined は JSON.stringify で自動除去）
  const meta = {
    session_id: getSessionId(),
    workspace_id: getWorkspaceId(),
    tab_id: getTabId(),
    init_at: nowIso(),
    shell_pid: shellPid,
    worker_name: process.env.CMUX_MSG_WORKER_NAME || undefined,
    parent_session_id: process.env.CMUX_MSG_PARENT_SESSION_ID || undefined,
    surface_ref: process.env.CMUX_MSG_SURFACE_REF || undefined,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

export function cmdInit(): void {
  requireCmux();

  const dir = myDir();
  initWorkspace(dir);

  console.log(`初期化完了: ${dir}`);
}
