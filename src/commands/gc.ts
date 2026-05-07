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

function reasonNotDeleted(
  peer: PeerEntry,
  mySessionId: string
): string | null {
  if (peer.sessionId === mySessionId) return "self";
  if (peer.alive) return "alive";
  if (!isDirEmpty(path.join(peer.dir, "inbox"))) return "inbox に残メッセージ";
  if (!isDirEmpty(path.join(peer.dir, "accepted")))
    return "accepted に残メッセージ";
  return null;
}

export function cmdGc(args: string[]): void {
  requireCmux();
  const force = args.includes("--force");
  const verbose = args.includes("--verbose");
  const mySessionId = getSessionId();

  const peers = listPeers(wsDir());

  // verbose 時は保持理由を全 peer 分表示する (なぜ消えなかったかの診断)
  const candidates: PeerEntry[] = [];
  const kept: Array<{ peer: PeerEntry; reason: string }> = [];
  for (const p of peers) {
    const reason = reasonNotDeleted(p, mySessionId);
    if (reason === null) {
      candidates.push(p);
    } else {
      kept.push({ peer: p, reason });
    }
  }

  if (verbose) {
    for (const k of kept) {
      console.log(
        `[keep:${k.reason}] ${k.peer.sessionId}${shortMeta(k.peer.dir)}`
      );
    }
  }

  if (candidates.length === 0) {
    console.log("掃除対象なし");
    if (!verbose && kept.length > 0) {
      console.log(
        `  (${kept.length}件 保持。--verbose で各保持理由を表示)`
      );
    }
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
    if (!verbose) {
      console.log(
        "  保持されるもの: inbox/accepted に残メッセージがある dead セッション、self、alive な peer (--verbose で詳細)"
      );
    }
  }
}
