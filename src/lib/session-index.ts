/**
 * surface_id → session_id の lookup index
 *
 * Claude Code の CLAUDE_ENV_FILE 経由で env を伝える方式が動作しない
 * (Issue #15840) ため、SessionStart hook がこの index を書き、
 * cmux-msg コマンドが CMUX_SURFACE_ID を起点に session_id を逆引きする。
 *
 * DR-0004: workspace_id 階層を廃止し `<base>/by-surface/<surface_id>` 直下に置く。
 * surface_id は cmux 全体で一意なので workspace で分ける必要がない。
 *
 * config.ts への循環依存を避けるため、ここではパスを env から直接組み立てる。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { UUID_PATTERN } from "./validate";

const INDEX_DIR = "by-surface";

function indexBaseDir(): string {
  const base =
    process.env.CMUXMSG_BASE ||
    path.join(os.homedir(), ".local/share/cmux-messages");
  return path.join(base, INDEX_DIR);
}

function indexPath(surfaceId: string): string {
  return path.join(indexBaseDir(), surfaceId);
}

export function writeBySurfaceIndex(
  surfaceId: string,
  sessionId: string
): void {
  const p = indexPath(surfaceId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, sessionId);
  fs.renameSync(tmp, p);
}

export function readBySurfaceIndex(surfaceId: string): string | null {
  try {
    const raw = fs.readFileSync(indexPath(surfaceId), "utf-8").trim();
    if (!raw || !UUID_PATTERN.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}
