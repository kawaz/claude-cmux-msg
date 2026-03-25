import { requireCmux } from "../config";
import { cmuxSend, cmuxSendKey } from "../lib/cmux";
import { validateSurfaceId } from "../lib/validate";

export async function cmdTell(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    console.error("使い方: cmux-msg tell <surface_ref> <テキスト>");
    process.exit(1);
  }

  const targetRef = args[0]!;
  validateSurfaceId(targetRef);
  const text = args.slice(1).join(" ");

  await cmuxSend(targetRef, text);
  await cmuxSendKey(targetRef, "Return");

  console.log(`送信完了: ${targetRef}`);
}
