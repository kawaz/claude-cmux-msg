import { requireCmux } from "../config";
import { cmuxCloseSurface } from "../lib/cmux";
import { validateSurfaceId } from "../lib/validate";

export async function cmdStop(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 1) {
    console.error("使い方: cmux-msg stop <surface_ref>");
    process.exit(1);
  }

  const targetRef = args[0]!;
  validateSurfaceId(targetRef);

  try {
    await cmuxCloseSurface(targetRef);
  } catch {
    // close 失敗は無視
  }

  console.log(`停止完了: ${targetRef}`);
}
