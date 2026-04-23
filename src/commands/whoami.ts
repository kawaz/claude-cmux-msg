import { requireCmux, getWorkspaceId, getSessionId, myDir } from "../config";

export function cmdWhoami(): void {
  requireCmux();
  console.log(`workspace:  ${getWorkspaceId()}`);
  console.log(`session_id: ${getSessionId()}`);
  console.log(`dir:        ${myDir()}`);
}
