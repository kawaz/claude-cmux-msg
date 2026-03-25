import * as fs from "fs";
import * as path from "path";
import {
  requireCmux,
  myDir,
  getSurfaceId,
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

  // メタ情報
  const meta = {
    surface_id: getSurfaceId(),
    workspace_id: getWorkspaceId(),
    tab_id: getTabId(),
    init_at: nowIso(),
    shell_pid: shellPid,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

export function cmdInit(): void {
  requireCmux();

  const dir = myDir();
  initWorkspace(dir);

  console.log(`初期化完了: ${dir}`);
}
