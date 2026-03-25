import { requireCmux } from "../config";
import { dismissMessage } from "../lib/message";
import { validateFilename } from "../lib/validate";

export function cmdDismiss(args: string[]): void {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg dismiss <filename>");
    process.exit(1);
  }

  const filename = args[0]!;
  validateFilename(filename);

  try {
    dismissMessage(filename);
    console.log(`破棄: ${filename} → archive/`);
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}
