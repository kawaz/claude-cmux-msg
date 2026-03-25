import { requireCmux } from "../config";
import { replyMessage } from "../lib/message";
import { validateFilename } from "../lib/validate";

export async function cmdReply(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    console.error("使い方: cmux-msg reply <filename> <返信内容>");
    process.exit(1);
  }

  const filename = args[0]!;
  validateFilename(filename);
  const body = args.slice(1).join(" ");

  try {
    await replyMessage(filename, body);
    console.log("返信送信 & アーカイブ完了");
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}
