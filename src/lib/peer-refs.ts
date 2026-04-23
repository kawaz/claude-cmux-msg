/**
 * peer session の surface_ref 解決
 *
 * cmux-msg の通信単位は claude session UUID だが、cmux API は surface:N を要求する。
 * 各 session は init 時に meta.json に自分の surface_ref を書き出す。
 * peer の surface_ref が必要な時は peer の meta.json を直接読む。
 */
import * as fs from "fs";
import * as path from "path";
import { peerDir } from "../config";
import { validateSessionId } from "./validate";

export function resolvePeerSurfaceRef(sessionId: string): string {
  validateSessionId(sessionId);
  const metaPath = path.join(peerDir(sessionId), "meta.json");
  if (!fs.existsSync(metaPath)) {
    throw new Error(
      `session ${sessionId} が見つかりません (meta.json なし)。cmux-msg peers で確認してください。`
    );
  }
  let meta: { surface_ref?: string };
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    throw new Error(`session ${sessionId} の meta.json が壊れています`);
  }
  if (!meta.surface_ref) {
    throw new Error(
      `session ${sessionId} の meta.json に surface_ref がありません`
    );
  }
  return meta.surface_ref;
}
