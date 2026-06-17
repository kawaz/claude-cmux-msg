import * as fs from "fs";
import * as path from "path";
import {
  requireSessionId,
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
import { detectRepoRoot } from "../lib/repo-root";
import { lookupSidProcess } from "../lib/session-proc";
import type { PeerMeta, SessionState } from "../types";
import { openDb } from "../lib/db";
import { upsertSession, addLabels } from "../lib/session-status";
import { computeScopeHashes } from "../lib/scope-hash";
import { parseLabels } from "../lib/label-parser";

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

  // DR-0007 決定7: 自分の claude プロセスを sid 照合 (ps) で引き、
  // (pid, start_time) を last_observed_pid として記録する (連続性検出専用)。
  // found 以外 (not_found / ambiguous / check_failed) なら未設定のままにする。
  // peer の alive 判定は `ps` の sid 照合 (DR-0007 決定1) で行うため pid ファイルは
  // 書かない。連続性検出は meta.json の last_observed_pid が担う。
  const sessionId = getSessionId();
  const selfLookup = lookupSidProcess(sessionId);
  const lastObservedPid =
    selfLookup.kind === "found"
      ? { pid: selfLookup.pid, start_time: selfLookup.startTime }
      : undefined;

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
    session_id: sessionId,
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
    // 照合失敗時は既存値があれば維持 (連続性情報を不用意に失わない)
    last_observed_pid: lastObservedPid ?? existing.last_observed_pid,
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

  // DR-0016: DB sessions に upsert + DR-0015: labels も反映 (失敗は silent)
  try {
    const db = openDb();
    try {
      const scopes = computeScopeHashes(cwd);
      const claudePid =
        selfLookup.kind === "found" ? selfLookup.pid : process.ppid;
      const nowMs = Date.now();
      upsertSession(db, {
        sid: sessionId,
        home: getClaudeHome(),
        cwd: scopes.cwd,
        cwdHash: scopes.cwdHash,
        ws: scopes.ws,
        wsHash: scopes.wsHash,
        repo: scopes.repo,
        repoHash: scopes.repoHash,
        state: initialState,
        pid: claudePid,
        startedAt: nowMs,
        lastSeen: nowMs,
        metaJson: null,
      });
      // labels: 新 CCMSG_LABELS env、旧 CMUXMSG_TAGS env も互換受付 (DR-0013)
      const labelsCsv =
        process.env.CCMSG_LABELS ?? process.env.CMUXMSG_TAGS ?? "";
      if (labelsCsv.trim().length > 0) {
        try {
          const labels = parseLabels(labelsCsv);
          if (labels.length > 0) addLabels(db, sessionId, labels);
        } catch {
          // 不正な label は silent skip
        }
      }
    } finally {
      db.close();
    }
  } catch (e) {
    process.stderr.write(
      `[cmux-msg init db] ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
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
  requireSessionId();

  const dir = myDir();
  initWorkspace(dir);

  console.log(`初期化完了: ${dir}`);
}
