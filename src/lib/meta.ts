/**
 * peer の meta.json 読み込みヘルパ。
 *
 * peers / broadcast / tell / screen / state など複数箇所で「meta.json を読んで
 * パース失敗は null で返す」処理が重複していたので、ここに集約する。
 *
 * 書き込み (transitionState / updateMeta) は src/lib/state.ts 側にある。
 */

import * as fs from "fs";
import * as path from "path";
import { peerDir } from "../config";
import type { PeerMeta } from "../types";

/**
 * 指定 dir の meta.json を読む。存在しない/壊れている時は null。
 *
 * `listPeers()` 結果の `peer.dir` をそのまま渡せるよう dir ベース。
 */
export function readMetaByDir(dir: string): PeerMeta | null {
  const p = path.join(dir, "meta.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PeerMeta;
  } catch {
    return null;
  }
}

/**
 * 指定 session_id の meta.json を読む。peerDir(sid) を経由する。
 */
export function readMetaBySid(sessionId: string): PeerMeta | null {
  return readMetaByDir(peerDir(sessionId));
}
