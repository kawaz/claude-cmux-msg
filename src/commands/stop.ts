import { requireCmux } from "../config";
import { cmuxCloseSurface } from "../lib/cmux";
import { validateSurfaceId } from "../lib/validate";
import { resolveCmuxRef } from "../lib/surface-refs";

export async function cmdStop(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg stop <uuid>");
    process.exit(1);
  }

  const uuid = args[0]!;
  validateSurfaceId(uuid);
  const ref = resolveCmuxRef(uuid);

  try {
    await cmuxCloseSurface(ref);
  } catch {
    // close 失敗は無視
  }

  console.log(`停止完了: ${uuid}`);
}
