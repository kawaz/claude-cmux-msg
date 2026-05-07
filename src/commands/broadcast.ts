import * as fs from "fs";
import * as path from "path";
import { requireCmux, wsDir, getSessionId } from "../config";
import { sendMessage } from "../lib/message";
import { listPeers } from "../lib/peer";

export async function cmdBroadcast(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg broadcast <メッセージ>");
    process.exit(1);
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

  const promises = targets.map((sid) =>
    sendMessage({ target: sid, body, type: "broadcast" })
  );
  const results = await Promise.allSettled(promises);
  const sent = results.filter((r) => r.status === "fulfilled").length;

  console.log(`ブロードキャスト完了: ${sent} ピアに送信`);
}
