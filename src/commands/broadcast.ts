import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { requireCmux, wsDir, getSessionId } from "../config";
import { sendMessage } from "../lib/sender";
import { listPeers } from "../lib/peer";
import { UsageError } from "../lib/errors";

export async function cmdBroadcast(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 1) {
    throw new UsageError("使い方: cmux-msg broadcast <メッセージ>");
  }

  const body = args.join(" ");
  const mySessionId = getSessionId();

  // alive な peer のみを対象。dead に送ると死蔵されるだけ。
  // by-surface 等のインデックスは listPeers が UUID パターンで弾く。
  const targets = listPeers(wsDir())
    .filter(
      (p) =>
        p.sessionId !== mySessionId &&
        p.alive &&
        fs.existsSync(path.join(p.dir, "inbox"))
    )
    .map((p) => p.sessionId);

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
