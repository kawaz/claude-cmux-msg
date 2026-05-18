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

  // DR-0007 決定2: surface は claude の tty から動的に逆引きする。
  // resolvePeerSurfaceRef が tty 逆引きを内包するので stop は追従するだけ。
  let ref: string;
  try {
    ref = await resolvePeerSurfaceRef(sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`停止対象の surface を解決できません: ${msg}`);
    process.exit(1);
  }

  try {
    await cmuxCloseSurface(ref);
  } catch {
    // close 失敗は無視
  }

  console.log(`停止完了: ${sessionId}`);
}
