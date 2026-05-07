import * as fs from "fs";
import * as path from "path";
import { requireCmux, wsDir, getSessionId } from "../config";
import { isSessionId } from "../lib/validate";

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

export function cmdPeers(args: string[] = []): void {
  requireCmux();

  const showAll = args.includes("--all");

  const dir = wsDir();
  const mySessionId = getSessionId();

  if (!fs.existsSync(dir)) {
    console.log("ピアなし");
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let printed = 0;
  let hiddenDead = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sid = entry.name;
    // セッションディレクトリ以外（broadcast / by-surface / 各種インデックス）は除外
    if (!isSessionId(sid)) continue;

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

    if (alive === "dead" && !showAll && sid !== mySessionId) {
      hiddenDead++;
      continue;
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
    printed++;
  }

  if (printed === 0 && hiddenDead === 0) {
    console.log("ピアなし");
  } else if (hiddenDead > 0) {
    console.log(`(dead ${hiddenDead}件 非表示。--all で全件表示)`);
  }
}
