import * as fs from "fs";
import * as path from "path";
import { readBySurfaceIndex } from "./lib/session-index";
import { getMsgBase } from "./lib/paths";

// 旧版の `MSG_BASE` 定数は廃止 (import 時固定値で env 切替が反映されない問題)。
// 全箇所で関数版 `getMsgBase()` を経由する。`config.ts` を import している
// 既存箇所は引き続き `getMsgBase` を re-export 経由で利用可能。
export { getMsgBase };

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
  return path.join(getMsgBase(), getWorkspaceId(), getSessionId());
}

/**
 * peer session のディレクトリを解決する。
 *
 * 解決順:
 *   1. 自 workspace 配下 (`<base>/<myWs>/<sid>/`) — 同一 ws 内通信の高速パス
 *   2. 全 workspace 走査 (`<base>/*​/<sid>/`) — cross-workspace 配送 (UUID 一意性に依存)
 *   3. 見つからなければ自 ws 配下のパスを返す (呼び出し側が existsSync でエラー判定)
 *
 * Design rationale: session_id (UUID v4) は cmux-messages 配下で workspace 横断的に
 * 一意な前提。`--workspace` 明示指定は UX を悪化させるだけなので採らない。
 * Phase 1 として走査ベースで実装し、必要なら後から `<base>/by-session/` index を
 * 上に被せて O(1) 化可能 (現状は workspace 数が高々 N=10〜20 で走査コスト無視できる)。
 */
export function peerDir(peerSessionId: string): string {
  const base = getMsgBase();
  const myWs = getWorkspaceId();

  const myWsCandidate = path.join(base, myWs, peerSessionId);
  if (fs.existsSync(myWsCandidate)) return myWsCandidate;

  try {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === myWs) continue;
      const candidate = path.join(base, entry.name, peerSessionId);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // base 自体が存在しない等は無視 (呼び出し側で exists チェックされる)
  }

  return myWsCandidate;
}

export function wsDir(): string {
  return path.join(getMsgBase(), getWorkspaceId());
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
  // bin/cmux-msg-bin (コンパイル済み) から実行されている場合、bin/ の親がプラグインルート
  const binDir = path.dirname(process.execPath || process.argv[0] || "");
  if (path.basename(binDir) === "bin") return path.dirname(binDir);
  // 最終フォールバック: cwd は確実に違う場所のことが多いので警告を出す
  process.stderr.write(
    `[warning] cmux-msg pluginRoot を解決できず cwd (${process.cwd()}) を使います。` +
      `CLAUDE_PLUGIN_ROOT または bin/cmux-msg-bin 経由の起動を推奨。\n`
  );
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
