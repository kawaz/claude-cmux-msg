import {
  requireSessionId,
  getSessionId,
  getMsgBase,
  myDir,
} from "../config";
import { listPeers, type PeerEntry } from "../lib/peer";
import { extractByArgs, matchAllAxes, describeAxis } from "../lib/peer-filter";
import { readMetaByDir } from "../lib/meta";
import { abbreviateHome } from "../lib/paths";

const PEERS_HELP = `使い方: cmux-msg peers [--by <axis>...] [--all] [--include-dead] [-v|--verbose]

軸なしのデフォルトは --by home (自 claude_home に閉じる、DR-0005)。

axis (複数指定可、AND 結合):
  --by home          自分と同じ claude_home の peer (デフォルト)
  --by cwd           自分と同じ cwd の peer (完全一致)
  --by cwd:<pat>     cwd に <pat> を含む peer (substring grep)
  --by repo          自分と同じ repo_root の peer
  --by repo:<pat>    repo_root に <pat> を含む peer (substring grep)
  --by tag:<name>    指定タグを持つ peer

明示的に壁を超える:
  --all              alive な全 peer (claude_home 壁を超える、軸無視)

その他:
  --include-dead     dead な peer も表示 (デフォルトは alive のみ)
  -v, --verbose      tags / home / repo_root 等の補助情報も出力

例:
  cmux-msg peers                      # 自 home の alive peer (= --by home)
  cmux-msg peers --by repo            # 同 repo の alive peer (home は問わない)
  cmux-msg peers --by cwd:cmux-msg    # cwd に cmux-msg を含む peer (prefix 違い吸収)
  cmux-msg peers --by home --by repo  # home AND repo 一致 (AND 結合)
  cmux-msg peers --all                # 全 home 横断 alive peer
  cmux-msg peers --all -v             # 上記 + tags/home 詳細`;

export function cmdPeers(args: string[] = []): void {
  requireSessionId();

  // --help → ヘルプ表示で終了
  if (args.includes("--help")) {
    console.log(PEERS_HELP);
    return;
  }

  const { axes, all, rest } = extractByArgs(args);
  const verbose = rest.includes("--verbose") || rest.includes("-v");
  const includeDead = rest.includes("--include-dead");
  const unknown = rest.filter(
    (a) => a !== "--include-dead" && a !== "--verbose" && a !== "-v"
  );
  if (unknown.length > 0) {
    console.error(`不明な引数: ${unknown.join(" ")}\n\n${PEERS_HELP}`);
    process.exit(1);
  }

  // DR-0005: 軸なしのデフォルトは --by home (自 claude_home に閉じる)
  const effectiveAxes = !all && axes.length === 0 ? [{ kind: "home" as const }] : axes;

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
      if (!matchAllAxes(myMeta!, peerMeta, effectiveAxes)) {
        filteredOut++;
        continue;
      }
    }

    const marker = isSelf ? " (self)" : "";
    const aliveLabel = peer.alive ? "alive" : "dead";
    const state = peerMeta?.state ?? "?";
    const cwd = peerMeta?.cwd ? abbreviateHome(peerMeta.cwd) : "(no meta)";

    if (verbose) {
      // 補助情報も並べる (= UUID 完全長は既に出てる)
      const home = peerMeta?.claude_home ? `  home=${abbreviateHome(peerMeta.claude_home)}` : "";
      const repo = peerMeta?.repo_root ? `  repo=${abbreviateHome(peerMeta.repo_root)}` : "";
      const tags = peerMeta?.tags && peerMeta.tags.length > 0 ? `  tags=${peerMeta.tags.join(",")}` : "";
      console.log(
        `${peer.sessionId}  ${aliveLabel}  state=${state}${marker}  cwd=${cwd}${repo}${home}${tags}`
      );
    } else {
      console.log(
        `${peer.sessionId}  ${aliveLabel}  state=${state}${marker}  ${cwd}`
      );
    }
    printed++;
  }

  if (printed === 0) {
    const cond = all
      ? "alive"
      : effectiveAxes.map(describeAxis).join(" AND ");
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
