import * as fs from "fs";
import * as path from "path";
import { requireCmux, peerDir } from "../config";
import { cmuxReadScreen } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { resolvePeerSurfaceRef } from "../lib/peer-refs";
import { isProcessForeground } from "../lib/peer";
import type { PeerMeta } from "../types";

/**
 * DR-0004: screen の安全境界。
 *
 * fg 必須: bg / suspended な session の surface を読むと、同 surface に居る
 * 別 sid のプロセス画面を誤読する事故が起きる。state は問わない (running 中の
 * 画面を見るのは正当なユースケース)。
 *
 * 引数なし (`screen` 単独) の場合は自分の surface を読むだけなので制約なし。
 */
function readPeerMeta(sessionId: string): PeerMeta | null {
  const metaPath = path.join(peerDir(sessionId), "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as PeerMeta;
  } catch {
    return null;
  }
}

export async function cmdScreen(args: string[]): Promise<void> {
  requireCmux();

  const sessionId = args[0];
  let ref: string | undefined;
  if (sessionId) {
    validateSessionId(sessionId);

    const meta = readPeerMeta(sessionId);
    if (!meta) {
      console.error(`session ${sessionId} の meta.json が見つかりません`);
      process.exit(1);
    }

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
