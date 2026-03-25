import * as fs from "fs";
import * as path from "path";
import { requireCmux, wsDir, getSurfaceId } from "../config";

function isProcessAlive(pid: number): boolean {
  // PID 1 は init プロセス。親プロセスが死んだ場合に ppid が 1 になるため dead 扱い
  if (pid === 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cmdPeers(): void {
  requireCmux();

  const dir = wsDir();
  const mySurface = getSurfaceId();

  if (!fs.existsSync(dir)) {
    console.log("ピアなし");
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sid = entry.name;
    if (sid === "broadcast") continue;

    const marker = sid === mySurface ? " (self)" : "";

    // 生存確認
    let alive = "dead";
    const pidFile = path.join(dir, sid, "pid");
    if (fs.existsSync(pidFile)) {
      const pidStr = fs.readFileSync(pidFile, "utf-8").trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && isProcessAlive(pid)) {
        alive = "alive";
      }
    }

    console.log(`${sid}  ${alive}${marker}`);
  }
}
