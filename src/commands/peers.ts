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

    // メタ情報からワーカー名・surface ref を取得
    let extra = "";
    const metaFile = path.join(dir, sid, "meta.json");
    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        const parts: string[] = [];
        if (meta.worker_name) parts.push(`name=${meta.worker_name}`);
        if (meta.surface_ref) parts.push(`ref=${meta.surface_ref}`);
        if (parts.length > 0) extra = `  ${parts.join(" ")}`;
      } catch {}
    }

    console.log(`${sid}  ${alive}${marker}${extra}`);
  }
}
