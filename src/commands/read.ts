import { requireCmux } from "../config";
import { readMessage } from "../lib/message";
import { validateFilename } from "../lib/validate";

export function cmdRead(args: string[]): void {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg read <filename>");
    process.exit(1);
  }

  const filename = args[0]!;
  validateFilename(filename);

  try {
    const content = readMessage(filename);
    console.log(content);
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}
