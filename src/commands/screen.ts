import { requireCmux } from "../config";
import { cmuxReadScreen } from "../lib/cmux";
import { validateSurfaceId } from "../lib/validate";

export async function cmdScreen(args: string[]): Promise<void> {
  requireCmux();

  const targetRef = args[0] || undefined;
  if (targetRef) {
    validateSurfaceId(targetRef);
  }
  const content = await cmuxReadScreen(targetRef, true);
  console.log(content);
}
