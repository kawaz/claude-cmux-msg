import { requireCmux } from "../config";
import { cmuxReadScreen } from "../lib/cmux";
import { validateSurfaceId } from "../lib/validate";
import { resolveCmuxRef } from "../lib/surface-refs";

export async function cmdScreen(args: string[]): Promise<void> {
  requireCmux();

  const uuid = args[0];
  let ref: string | undefined;
  if (uuid) {
    validateSurfaceId(uuid);
    ref = resolveCmuxRef(uuid);
  }
  const content = await cmuxReadScreen(ref, true);
  console.log(content);
}
