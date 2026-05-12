import * as path from "path";
import {
  requireCmux,
  getSessionId,
  getMsgBase,
  myDir,
} from "../config";
import { listPeers, type PeerEntry } from "../lib/peer";
import { extractByArgs, matchAllAxes, describeAxis } from "../lib/peer-filter";
import { readMetaByDir } from "../lib/meta";

const PEERS_HELP = `使い方: cmux-msg peers (--by <axis>... | --all) [--include-dead]

axis (複数指定可、AND 結合):
  --by home          自分と同じ claude_home の peer
  --by ws            自分と同じ workspace の peer
  --by cwd           自分と同じ cwd の peer
  --by repo          自分と同じ repo_root の peer
  --by tag:<name>    指定タグを持つ peer

明示的に全 alive 列挙:
  --all              alive な全 peer (軸無視)

その他:
  --include-dead     dead な peer も表示 (デフォルトは alive のみ)

例:
  cmux-msg peers --by repo            # 同 repo の alive peer
  cmux-msg peers --by home --by ws    # claude_home AND workspace 一致
  cmux-msg peers --all                # alive な全 peer`;

export function cmdPeers(args: string[] = []): void {
  requireCmux();

  // 引数なし / --help → ヘルプ表示で終了 (DR-0004: デフォルト動作なし)
  if (args.length === 0 || args.includes("--help")) {
    console.log(PEERS_HELP);
    return;
  }

  const { axes, all, rest } = extractByArgs(args);
  const includeDead = rest.includes("--include-dead");
  const unknown = rest.filter((a) => a !== "--include-dead");
  if (unknown.length > 0) {
    console.error(`不明な引数: ${unknown.join(" ")}\n\n${PEERS_HELP}`);
    process.exit(1);
  }

  if (!all && axes.length === 0) {
    console.error(`--by <axis> または --all が必要です\n\n${PEERS_HELP}`);
    process.exit(1);
  }

  const mySessionId = getSessionId();
  const myMeta = readMetaByDir(myDir());
  if (!myMeta && !all) {
    console.error(
      "自分の meta.json が見つかりません。SessionStart hook が走っていません。"
    );
    process.exit(1);
  }

  const peers: PeerEntry[] = listPeers(getMsgBase());

  let printed = 0;
  let hiddenDead = 0;
  let filteredOut = 0;

  for (const peer of peers) {
    const isSelf = peer.sessionId === mySessionId;

    if (!peer.alive && !includeDead && !isSelf) {
      hiddenDead++;
      continue;
    }

    const peerMeta = readMetaByDir(peer.dir);

    // --all 未指定なら axis フィルタを適用 (self は素通り)
    if (!all && !isSelf) {
      if (!peerMeta) {
        // meta 無しは axis 評価不能 → 弾く
        filteredOut++;
        continue;
      }
      if (!matchAllAxes(myMeta!, peerMeta, axes)) {
        filteredOut++;
        continue;
      }
    }

    const marker = isSelf ? " (self)" : "";
    const aliveLabel = peer.alive ? "alive" : "dead";
    const state = peerMeta?.state ?? "?";
    const name = peerMeta?.worker_name ? `  name=${peerMeta.worker_name}` : "";
    const ws = peerMeta?.workspace_id ? `  ws=${peerMeta.workspace_id}` : "";

    console.log(
      `${peer.sessionId}  ${aliveLabel}  state=${state}${marker}${ws}${name}`
    );
    printed++;
  }

  if (printed === 0) {
    const cond = all
      ? "alive"
      : axes.map(describeAxis).join(" AND ");
    console.log(`ピアなし (条件: ${cond})`);
    if (hiddenDead > 0) {
      console.log(`  (dead ${hiddenDead}件 非表示。--include-dead で全件)`);
    }
    if (filteredOut > 0) {
      console.log(`  (filter で除外 ${filteredOut}件)`);
    }
  } else if (hiddenDead > 0) {
    console.log(`(dead ${hiddenDead}件 非表示。--include-dead で全件表示)`);
  }
}
