import * as fs from "fs";
import * as path from "path";
import {
  requireCmux,
  myDir,
  getSessionId,
  getWorkspaceId,
  getTabId,
  getClaudeHome,
  nowIso,
  pluginRoot,
  getMsgBase,
} from "../config";
import { setupLayoutDocs } from "../lib/layout-docs";
import { formatPidFile } from "../lib/peer";
import { detectRepoRoot } from "../lib/repo-root";
import type { PeerMeta, SessionState } from "../types";

export interface InitOptions {
  /** SessionStart hook の input.cwd。未指定なら process.cwd()。meta.json の cwd / repo_root 算出に使う */
  cwd?: string;
}

/**
 * ワークスペース初期化（共通処理）
 *
 * session-start.ts からも呼ばれる。再 init (resume / 二度目以降の hook) でも
 * 既存 meta.json があれば init_at を維持し、last_started_at だけ更新する。
 */
export function initWorkspace(dir: string, opts: InitOptions = {}): void {
  for (const sub of ["inbox", "accepted", "archive", "sent", "tmp"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  // シェルの PID + 起動時刻を記録して生存確認に使う。
  // PID 単独だと再利用で誤判定するため lstart も併記する (formatPidFile)
  // tmp + rename で原子化。中途半端な内容を他プロセスに読まれない。
  const shellPid = process.ppid || process.pid;
  const pidFile = path.join(dir, "pid");
  const pidTmp = `${pidFile}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(pidTmp, formatPidFile(shellPid));
  fs.renameSync(pidTmp, pidFile);

  const now = nowIso();
  const cwd = opts.cwd ?? process.cwd();
  const repoRoot = detectRepoRoot(cwd);

  // 既存 meta があれば init_at を維持する (resume / 再 hook 対応)。
  // state は SessionStart 時点では idle に戻す (前回 stopped でも再開なら idle)。
  const metaFile = path.join(dir, "meta.json");
  let existing: Partial<PeerMeta> = {};
  if (fs.existsSync(metaFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const tagsEnv = process.env.CMUXMSG_TAGS || "";
  const tags = tagsEnv
    ? tagsEnv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : (existing.tags ?? []);

  const initialState: SessionState = "idle";

  const meta: PeerMeta = {
    session_id: getSessionId(),
    parent_session_id:
      process.env.CMUXMSG_PARENT_SESSION_ID || existing.parent_session_id,
    worker_name: process.env.CMUXMSG_WORKER_NAME || existing.worker_name,
    claude_home: getClaudeHome(),
    workspace_id: getWorkspaceId(),
    tab_id: getTabId() || existing.tab_id,
    surface_id: process.env.CMUX_SURFACE_ID || existing.surface_id,
    surface_ref: process.env.CMUXMSG_SURFACE_REF || existing.surface_ref,
    cwd,
    repo_root: repoRoot ?? existing.repo_root,
    tags,
    state: initialState,
    state_changed_at: now,
    init_at: existing.init_at ?? now,
    last_started_at: now,
    last_ended_at: undefined, // 新セッション開始では未終了にリセット
    shell_pid: shellPid,
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  // 各階層に「ここは何の場所か」を示す README.md (symlink) を貼る
  // 失敗してもメッセージング機能には影響しないため例外は投げない
  setupLayoutDocs({
    msgBase: getMsgBase(),
    pluginRoot: pluginRoot(),
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
