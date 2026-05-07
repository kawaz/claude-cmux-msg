import { requireCmux } from "../config";
import { dismissMessage } from "../lib/transition";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";

export function cmdDismiss(args: string[]): void {
  requireCmux();

  if (args.length < 1) {
    throw new UsageError("使い方: cmux-msg dismiss <filename>");
  }

  const filename = args[0]!;
  validateFilename(filename);

  dismissMessage(filename);
  console.log(`破棄: ${filename} → archive/`);
}
