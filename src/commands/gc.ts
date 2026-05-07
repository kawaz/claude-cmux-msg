/**
 * dead な過去セッションのディレクトリを掃除する。
 *
 * 削除条件 (すべて満たすもののみ):
 *   - PID + lstart 判定で dead
 *   - 自分 (self) ではない
 *   - inbox/ が空 (未処理メッセージなし)
 *   - accepted/ が空 (作業中扱いのメッセージなし)
 *
 * archive/ と sent/ は履歴目的だが、セッション自体が dead でメッセージも
 * 処理済みなら一緒に消す。残したい場合は事前にバックアップを推奨。
 *
 * 既定は dry-run。`--force` で実際に削除。
 */

import * as fs from "fs";
import * as path from "path";
import { requireCmux, wsDir, getSessionId } from "../config";
import { listPeers, type PeerEntry } from "../lib/peer";

function isDirEmpty(dir: string): boolean {
  if (!fs.existsSync(dir)) return true;
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length === 0;
  } catch {
    return true;
  }
}

function shortMeta(peerDir: string): string {
  const metaFile = path.join(peerDir, "meta.json");
  if (!fs.existsSync(metaFile)) return "";
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
    return meta.worker_name ? ` name=${meta.worker_name}` : "";
  } catch {
    return "";
  }
}

export function cmdGc(args: string[]): void {
  requireCmux();
  const force = args.includes("--force");
  const mySessionId = getSessionId();

  const peers = listPeers(wsDir());
  const candidates: PeerEntry[] = peers.filter(
    (p) =>
      !p.alive &&
      p.sessionId !== mySessionId &&
      isDirEmpty(path.join(p.dir, "inbox")) &&
      isDirEmpty(path.join(p.dir, "accepted"))
  );

  if (candidates.length === 0) {
    console.log("掃除対象なし");
    return;
  }

  for (const c of candidates) {
    const flag = force ? "[delete]" : "[dry-run]";
    console.log(`${flag} ${c.sessionId}${shortMeta(c.dir)}`);
    if (force) {
      try {
        fs.rmSync(c.dir, { recursive: true, force: true });
      } catch (e) {
        console.error(`  → 削除失敗: ${(e as Error).message}`);
      }
    }
  }

  if (force) {
    console.log(`(${candidates.length}件 削除完了)`);
  } else {
    console.log(`(${candidates.length}件 削除候補。--force で実行)`);
    console.log("  保持されるもの: inbox/accepted に残メッセージがある dead セッション、self、alive な peer");
  }
}
