import * as fs from "fs";
import * as path from "path";
import { requireCmux, wsDir, getSessionId } from "../config";
import { listPeers } from "../lib/peer";

export function cmdPeers(args: string[] = []): void {
  requireCmux();

  const showAll = args.includes("--all");
  const mySessionId = getSessionId();
  const peers = listPeers(wsDir());

  let printed = 0;
  let hiddenDead = 0;

  for (const peer of peers) {
    const marker = peer.sessionId === mySessionId ? " (self)" : "";
    const aliveLabel = peer.alive ? "alive" : "dead";

    if (!peer.alive && !showAll && peer.sessionId !== mySessionId) {
      hiddenDead++;
      continue;
    }

    // メタ情報からワーカー名を取得（surface_ref は cmux 内部詳細なので非表示）
    let nameLabel = "";
    const metaFile = path.join(peer.dir, "meta.json");
    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        if (meta.worker_name) nameLabel = `  name=${meta.worker_name}`;
      } catch {}
    }

    console.log(`${peer.sessionId}  ${aliveLabel}${marker}${nameLabel}`);
    printed++;
  }

  if (printed === 0 && hiddenDead === 0) {
    console.log("ピアなし");
  } else if (hiddenDead > 0) {
    console.log(`(dead ${hiddenDead}件 非表示。--all で全件表示)`);
  }
}
