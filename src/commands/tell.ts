import { requireCmux } from "../config";
import { cmuxSend, cmuxSendKey } from "../lib/cmux";
import { validateSurfaceId } from "../lib/validate";
import { resolveCmuxRef } from "../lib/surface-refs";

export async function cmdTell(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    console.error("使い方: cmux-msg tell <uuid> <テキスト>");
    process.exit(1);
  }

  const uuid = args[0]!;
  validateSurfaceId(uuid);
  const text = args.slice(1).join(" ");
  const ref = resolveCmuxRef(uuid);

  await cmuxSend(ref, text);
  await cmuxSendKey(ref, "Return");

  console.log(`送信完了: ${uuid}`);
}
