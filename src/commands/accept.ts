import { requireCmux } from "../config";
import { acceptMessage } from "../lib/transition";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";

export function cmdAccept(args: string[]): void {
  requireCmux();

  if (args.length < 1) {
    throw new UsageError("使い方: cmux-msg accept <filename>");
  }

  const filename = args[0]!;
  validateFilename(filename);

  acceptMessage(filename);
  console.log(`受理: ${filename} → accepted/`);
}
