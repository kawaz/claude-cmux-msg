import { requireSessionId } from "../config";
import { acceptMessage } from "../lib/transition";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";

const ACCEPT_USAGE = `使い方: cmux-msg accept <filename>

メッセージを受理 (= read 済 + 何らかの応答 / action を完了) して accepted/ に移す。
返信が不要な closure (= peer から ack を受け取って議論が閉じた等) の終端処理にも accept を使う。

判断ガイド:
  - 返信する場合       → reply (内部で accept してから archive まで一気)
  - 返信不要、ack 受領 → accept (= 受け止めた)
  - 内容を否定して破棄 → dismiss (= 受け止めず破棄)`;

export function cmdAccept(args: string[]): void {
  requireSessionId();

  if (args.length < 1) {
    throw new UsageError(ACCEPT_USAGE);
  }
  if (args[0] === "--help") {
    console.log(ACCEPT_USAGE);
    return;
  }

  const filename = args[0]!;
  validateFilename(filename);

  acceptMessage(filename);
  console.log(`受理: ${filename} → accepted/`);
}
