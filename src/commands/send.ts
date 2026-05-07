import { requireCmux } from "../config";
import { sendMessage } from "../lib/message";
import { validateSessionId } from "../lib/validate";
import { UsageError } from "../lib/errors";

export async function cmdSend(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    throw new UsageError("使い方: cmux-msg send <session_id> <メッセージ>");
  }

  const target = args[0]!;
  validateSessionId(target);
  const body = args.slice(1).join(" ");

  const filename = await sendMessage({ target, body });
  console.log(`送信完了: ${filename} → ${target}`);
}
