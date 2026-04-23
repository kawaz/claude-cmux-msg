import { requireCmux } from "../config";
import { cmuxSend, cmuxSendKey } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { resolvePeerSurfaceRef } from "../lib/peer-refs";

export async function cmdTell(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    console.error("使い方: cmux-msg tell <session_id> <テキスト>");
    process.exit(1);
  }

  const sessionId = args[0]!;
  validateSessionId(sessionId);
  const text = args.slice(1).join(" ");
  const ref = resolvePeerSurfaceRef(sessionId);

  await cmuxSend(ref, text);
  await cmuxSendKey(ref, "Return");

  console.log(`送信完了: ${sessionId}`);
}
