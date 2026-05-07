import { requireCmux } from "../config";
import { replyMessage } from "../lib/transition";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";

export async function cmdReply(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    throw new UsageError("使い方: cmux-msg reply <filename> <返信内容>");
  }

  const filename = args[0]!;
  validateFilename(filename);
  const body = args.slice(1).join(" ");

  await replyMessage(filename, body);
  console.log("返信送信 & アーカイブ完了");
}
