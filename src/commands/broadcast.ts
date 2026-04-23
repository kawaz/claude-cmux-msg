import * as fs from "fs";
import * as path from "path";
import { requireCmux, wsDir, getSessionId } from "../config";
import { sendMessage } from "../lib/message";

export async function cmdBroadcast(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg broadcast <メッセージ>");
    process.exit(1);
  }

  const body = args.join(" ");
  const dir = wsDir();
  const mySessionId = getSessionId();

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const targets = entries
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      const sid = entry.name;
      if (sid === mySessionId || sid === "broadcast") return false;
      const inboxDir = path.join(dir, sid, "inbox");
      return fs.existsSync(inboxDir);
    })
    .map((entry) => entry.name);

  const promises = targets.map((sid) =>
    sendMessage({ target: sid, body, type: "broadcast" })
  );
  const results = await Promise.allSettled(promises);
  const sent = results.filter((r) => r.status === "fulfilled").length;

  console.log(`ブロードキャスト完了: ${sent} ピアに送信`);
}
