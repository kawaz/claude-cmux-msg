import { requireCmux } from "../config";
import { cmuxReadScreen } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { resolvePeerSurfaceRef } from "../lib/peer-refs";
import { isProcessForeground } from "../lib/peer";
import { readMetaBySid, warnIfCrossHome } from "../lib/meta";

/**
 * DR-0004: screen の安全境界。
 *
 * fg 必須: bg / suspended な session の surface を読むと、同 surface に居る
 * 別 sid のプロセス画面を誤読する事故が起きる。state は問わない (running 中の
 * 画面を見るのは正当なユースケース)。
 *
 * 引数なし (`screen` 単独) の場合は自分の surface を読むだけなので制約なし。
 */
export async function cmdScreen(args: string[]): Promise<void> {
  requireCmux();

  const sessionId = args[0];
  let ref: string | undefined;
  if (sessionId) {
    validateSessionId(sessionId);

    const meta = readMetaBySid(sessionId);
    if (!meta) {
      console.error(`session ${sessionId} の meta.json が見つかりません`);
      process.exit(1);
    }

    // DR-0005: peer が別 claude_home なら warning (block しない)
    warnIfCrossHome(meta);

    if (!isProcessForeground(meta.shell_pid)) {
      console.error(
        `session ${sessionId} は foreground にないため screen を拒否しました ` +
          `(別 sid の画面を誤読する事故を避けるため)。`
      );
      process.exit(1);
    }

    ref = resolvePeerSurfaceRef(sessionId);
  }
  const content = await cmuxReadScreen(ref, true);
  console.log(content);
}
