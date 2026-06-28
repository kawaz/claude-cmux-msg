import { requireSessionId } from "../config";
import { dismissMessage } from "../lib/transition";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";

const DISMISS_USAGE = `使い方: cmux-msg dismiss <filename>

メッセージを破棄 (= 内容を受け止めず却下) して archive/ に移す。
ack 受領 / closure 受諾 (= 内容を肯定的に受け止める) は accept を使う。

判断ガイド:
  - 返信する場合       → reply (内部で accept してから archive まで一気)
  - 返信不要、ack 受領 → accept (= 受け止めた)
  - 内容を否定して破棄 → dismiss (= 受け止めず破棄)`;

export function cmdDismiss(args: string[]): void {
  requireSessionId();

  if (args.length < 1) {
    throw new UsageError(DISMISS_USAGE);
  }
  if (args[0] === "--help") {
    console.log(DISMISS_USAGE);
    return;
  }

  const filename = args[0]!;
  validateFilename(filename);

  dismissMessage(filename);
  console.log(`破棄: ${filename} → archive/`);
}
