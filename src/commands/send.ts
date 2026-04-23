import { requireCmux } from "../config";
import { sendMessage } from "../lib/message";
import { validateSessionId } from "../lib/validate";

export async function cmdSend(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    console.error("使い方: cmux-msg send <session_id> <メッセージ>");
    process.exit(1);
  }

  const target = args[0]!;
  validateSessionId(target);
  const body = args.slice(1).join(" ");

  try {
    const filename = await sendMessage({ target, body });
    console.log(`送信完了: ${filename} → ${target}`);
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}
