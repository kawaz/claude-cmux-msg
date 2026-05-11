import * as fs from "fs";
import * as path from "path";
import {
  requireCmux,
  wsDir,
  getSessionId,
  getWorkspaceId,
  getMsgBase,
} from "../config";
import { listPeers, type PeerEntry } from "../lib/peer";

interface PeerWithWs extends PeerEntry {
  workspaceId: string;
}

function collectAllWorkspaces(): PeerWithWs[] {
  const base = getMsgBase();
  const result: PeerWithWs[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const peers = listPeers(path.join(base, entry.name));
    for (const p of peers) result.push({ ...p, workspaceId: entry.name });
  }
  return result;
}

export function cmdPeers(args: string[] = []): void {
  requireCmux();

  const showAll = args.includes("--all");
  const allWorkspaces =
    args.includes("--all-workspaces") || args.includes("--global");

  const mySessionId = getSessionId();
  const myWs = getWorkspaceId();

  const peers: PeerWithWs[] = allWorkspaces
    ? collectAllWorkspaces()
    : listPeers(wsDir()).map((p) => ({ ...p, workspaceId: myWs }));

  let printed = 0;
  let hiddenDead = 0;

  for (const peer of peers) {
    const isSelf = peer.sessionId === mySessionId;
    const marker = isSelf ? " (self)" : "";
    const aliveLabel = peer.alive ? "alive" : "dead";

    if (!peer.alive && !showAll && !isSelf) {
      hiddenDead++;
      continue;
    }

    let nameLabel = "";
    const metaFile = path.join(peer.dir, "meta.json");
    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        if (meta.worker_name) nameLabel = `  name=${meta.worker_name}`;
      } catch {}
    }

    // --all-workspaces 時のみ workspace_id を表示 (普段は冗長)
    const wsLabel = allWorkspaces ? `  ws=${peer.workspaceId}` : "";
    console.log(
      `${peer.sessionId}  ${aliveLabel}${marker}${wsLabel}${nameLabel}`
    );
    printed++;
  }

  if (printed === 0 && hiddenDead === 0) {
    console.log("ピアなし");
  } else if (hiddenDead > 0) {
    console.log(`(dead ${hiddenDead}件 非表示。--all で全件表示)`);
  }
}
