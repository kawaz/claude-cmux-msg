import { requireCmux } from "../config";
import { readMessage } from "../lib/inbox";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";

export function cmdRead(args: string[]): void {
  requireCmux();

  if (args.length < 1) {
    throw new UsageError("使い方: cmux-msg read <filename>");
  }

  const filename = args[0]!;
  validateFilename(filename);

  const content = readMessage(filename);
  console.log(content);
}
