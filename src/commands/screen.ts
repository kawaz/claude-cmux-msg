import { requireCmux } from "../config";
import { cmuxReadScreen } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { resolvePeerSurfaceRef } from "../lib/peer-refs";

export async function cmdScreen(args: string[]): Promise<void> {
  requireCmux();

  const sessionId = args[0];
  let ref: string | undefined;
  if (sessionId) {
    validateSessionId(sessionId);
    ref = resolvePeerSurfaceRef(sessionId);
  }
  const content = await cmuxReadScreen(ref, true);
  console.log(content);
}
