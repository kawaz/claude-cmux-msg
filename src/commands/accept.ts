import { requireCmux } from "../config";
import { acceptMessage } from "../lib/message";
import { validateFilename } from "../lib/validate";

export function cmdAccept(args: string[]): void {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg accept <filename>");
    process.exit(1);
  }

  const filename = args[0]!;
  validateFilename(filename);

  try {
    acceptMessage(filename);
    console.log(`受理: ${filename} → accepted/`);
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}
