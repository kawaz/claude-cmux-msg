import * as fs from "fs";
import * as path from "path";
import { requireCmux, wsDir, getSessionId } from "../config";

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
  const mySessionId = getSessionId();

  if (!fs.existsSync(dir)) {
    console.log("ピアなし");
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sid = entry.name;
    if (sid === "broadcast") continue;

    const marker = sid === mySessionId ? " (self)" : "";

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

    // メタ情報からワーカー名を取得（surface_ref は cmux 内部詳細なので非表示）
    let nameLabel = "";
    const metaFile = path.join(dir, sid, "meta.json");
    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        if (meta.worker_name) nameLabel = `  name=${meta.worker_name}`;
      } catch {}
    }

    console.log(`${sid}  ${alive}${marker}${nameLabel}`);
  }
}
