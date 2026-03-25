import { requireCmux, getWorkspaceId, getSurfaceId, myDir } from "../config";

export function cmdWhoami(): void {
  requireCmux();
  console.log(`workspace: ${getWorkspaceId()}`);
  console.log(`surface:   ${getSurfaceId()}`);
  console.log(`dir:       ${myDir()}`);
}
