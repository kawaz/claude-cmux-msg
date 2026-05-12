import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { requireCmux, getMsgBase, getSessionId, myDir } from "../config";
import { sendMessage } from "../lib/sender";
import { listPeers } from "../lib/peer";
import {
  extractByArgs,
  matchAllAxes,
  describeAxis,
} from "../lib/peer-filter";
import { readMetaByDir } from "../lib/meta";
import { UsageError } from "../lib/errors";

const BROADCAST_HELP = `使い方: cmux-msg broadcast [--by <axis>...] [--all] <メッセージ>

軸なしのデフォルトは --by home (自 claude_home に閉じる、DR-0005)。

軸 (複数指定可、AND 結合):
  --by home          自分と同じ claude_home の alive peer (デフォルト)
  --by ws            自分と同じ workspace の alive peer
  --by cwd           自分と同じ cwd の alive peer
  --by repo          自分と同じ repo_root の alive peer
  --by tag:<name>    指定タグを持つ alive peer

明示的に壁を超える:
  --all              alive な全 peer (claude_home 壁を超える、軸無視)

例:
  cmux-msg broadcast "build 通った"          # 自 home の alive peer
  cmux-msg broadcast --by repo "build 通った" # 同 repo の alive peer (home 問わない)
  cmux-msg broadcast --all "全員 stop"        # 全 home 横断`;

export async function cmdBroadcast(args: string[]): Promise<void> {
  requireCmux();

  if (args.includes("--help")) {
    console.log(BROADCAST_HELP);
    return;
  }

  const { axes, all, rest } = extractByArgs(args);

  if (rest.length === 0) {
    throw new UsageError(`メッセージ本文が空です\n\n${BROADCAST_HELP}`);
  }

  // DR-0005: 軸なしのデフォルトは --by home
  const effectiveAxes = !all && axes.length === 0 ? [{ kind: "home" as const }] : axes;

  const body = rest.join(" ");
  const mySessionId = getSessionId();
  const myMeta = readMetaByDir(myDir());
  if (!myMeta && !all) {
    throw new UsageError(
      "自分の meta.json が見つかりません。SessionStart hook が走っていません。"
    );
  }

  // alive な peer のみを対象。dead に送ると死蔵されるだけ。
  const peers = listPeers(getMsgBase());
  const targets: string[] = [];
  for (const p of peers) {
    if (p.sessionId === mySessionId) continue;
    if (!p.alive) continue;
    if (!fs.existsSync(path.join(p.dir, "inbox"))) continue;
    if (!all) {
      const peerMeta = readMetaByDir(p.dir);
      if (!peerMeta) continue;
      if (!matchAllAxes(myMeta!, peerMeta, effectiveAxes)) continue;
    }
    targets.push(p.sessionId);
  }

  if (targets.length === 0) {
    const cond = all
      ? "alive"
      : effectiveAxes.map(describeAxis).join(" AND ");
    console.log(`broadcast 対象なし (条件: ${cond})`);
    return;
  }

  // この 1 broadcast で送る N 件のメッセージに共通の ID を付ける。
  // 受信側 / 送信側どちらからでも broadcast_id でグルーピングできる。
  const broadcastId = randomUUID();

  const promises = targets.map((sid) =>
    sendMessage({ target: sid, body, type: "broadcast", broadcastId })
  );
  const results = await Promise.allSettled(promises);
  const sent = results.filter((r) => r.status === "fulfilled").length;

  // 失敗があれば理由を stderr に詳細出力 + exit code 2 (部分失敗)。
  // 旧実装は失敗を握りつぶして「N ピアに送信」と表示するだけだった。
  const failures: Array<{ sid: string; reason: string }> = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const reason =
        r.reason instanceof Error
          ? r.reason.message
          : String(r.reason);
      failures.push({ sid: targets[i]!, reason });
    }
  });

  for (const f of failures) {
    process.stderr.write(`broadcast 失敗 [${f.sid}]: ${f.reason}\n`);
  }
  console.log(`ブロードキャスト完了: ${sent}/${results.length} ピアに送信`);

  if (failures.length > 0) {
    // exit code 2 = 部分失敗 (1 = 全体エラーと区別)
    process.exit(2);
  }
}
