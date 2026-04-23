import { requireCmux } from "../config";
import { cmuxCloseSurface } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { resolvePeerSurfaceRef } from "../lib/peer-refs";

export async function cmdStop(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg stop <session_id>");
    process.exit(1);
  }

  const sessionId = args[0]!;
  validateSessionId(sessionId);
  const ref = resolvePeerSurfaceRef(sessionId);

  try {
    await cmuxCloseSurface(ref);
  } catch {
    // close 失敗は無視
  }

  console.log(`停止完了: ${sessionId}`);
}
