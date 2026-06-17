import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { requireSessionId, getMsgBase, getSessionId, myDir } from "../config";
import { sendMessage } from "../lib/sender";
import { listPeers } from "../lib/peer";
import {
  extractByArgs,
  matchAllAxes,
  describeAxis,
  type ByAxis,
} from "../lib/peer-filter";
import { readMetaByDir } from "../lib/meta";
import { UsageError } from "../lib/errors";
import { looksLikeFlag } from "../lib/argv";

const BROADCAST_HELP = `使い方:
  cmux-msg broadcast [--by <axis>...] [--all]                # 本文 stdin
  cmux-msg broadcast [--by <axis>...] [--all] --text "<msg>" # 一言オプション
  cmux-msg broadcast [--by <axis>...] [--all] < msg.md       # ファイル経由

軸なしのデフォルトは --by home (自 claude_home に閉じる、DR-0005)。
本文を positional 引数で受けることはしない (DR-0014)。

軸 (複数指定可、AND 結合):
  --by home          自分と同じ claude_home の alive peer (デフォルト)
  --by ws            自分と同じ workspace の alive peer
  --by cwd           自分と同じ cwd の alive peer
  --by repo          自分と同じ repo_root の alive peer
  --by tag:<name>    指定タグを持つ alive peer

明示的に壁を超える:
  --all              alive な全 peer (claude_home 壁を超える、軸無視)

例:
  echo "build 通った" | cmux-msg broadcast              # 自 home の alive peer
  cmux-msg broadcast --by repo --text "build 通った"    # 同 repo の alive peer
  cmux-msg broadcast --all < notice.md                  # 全 home 横断`;

export interface ParsedBroadcastArgs {
  axes: ByAxis[];
  all: boolean;
  help: boolean;
  text?: string;
}

export function parseBroadcastArgs(args: string[]): ParsedBroadcastArgs {
  if (args.includes("--help")) {
    return { axes: [], all: false, help: true };
  }

  // --text 値が "-" や by axes 引数と紛らわしくないよう、先に --text を抽出
  const remaining: string[] = [];
  let text: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--text") {
      const v = args[i + 1];
      if (v === undefined) {
        throw new UsageError("--text には値が必要です\n\n" + BROADCAST_HELP);
      }
      text = v;
      i++;
    } else if (a.startsWith("--text=")) {
      text = a.slice("--text=".length);
    } else {
      remaining.push(a);
    }
  }

  const { axes, all, rest } = extractByArgs(remaining);

  // 残った -/-- 始まり引数は未知フラグ、本文 positional は受けない
  for (const a of rest) {
    if (looksLikeFlag(a)) {
      throw new UsageError(`不明なオプション: ${a}\n\n${BROADCAST_HELP}`);
    }
    throw new UsageError(
      `本文を positional 引数で受けることはできません: ${a}\n--text または stdin を使ってください\n\n${BROADCAST_HELP}`
    );
  }

  return { axes, all, help: false, text };
}

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

async function resolveBroadcastBody(parsed: ParsedBroadcastArgs): Promise<string> {
  if (parsed.text !== undefined) {
    return parsed.text;
  }
  if (process.stdin.isTTY) {
    throw new UsageError(
      "stdin が TTY で --text も指定されていません。\n\n" + BROADCAST_HELP
    );
  }
  return await readStdin();
}

export async function cmdBroadcast(args: string[]): Promise<void> {
  requireSessionId();

  const parsed = parseBroadcastArgs(args);
  if (parsed.help) {
    console.log(BROADCAST_HELP);
    return;
  }

  const body = await resolveBroadcastBody(parsed);
  if (body.length === 0) {
    throw new UsageError(`メッセージ本文が空です\n\n${BROADCAST_HELP}`);
  }

  const { axes, all } = parsed;

  // DR-0005: 軸なしのデフォルトは --by home
  const effectiveAxes = !all && axes.length === 0 ? [{ kind: "home" as const }] : axes;
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
