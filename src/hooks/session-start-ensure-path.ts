#!/usr/bin/env bun
/**
 * SessionStart フック: PATH 上の cmux-msg を最新版に揃える。
 *
 * 動作:
 *   1. このフック自身の realpath から plugin root を導出 (= 最新版の実体)
 *   2. `which cmux-msg` で PATH 上の cmux-msg を探す
 *   3. 不在 → AI に symlink 作成依頼メッセージを stdout に出す
 *   4. realpath が hook 側と一致 → 何もしない
 *   5. symlink で realpath 不一致 → 自動で張り替える (= 旧版を指していた)
 *   6. 実体が regular file 等で不一致 → AI に手動置換を依頼するメッセージ
 *
 * 既存 session-start.ts とは別フックとして hooks.json に並べて登録する。
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  decidePathAction,
  renderDecisionMessage,
  pickHomeBinCandidates,
} from "../lib/ensure-path";

function whichCmuxMsg(): string | null {
  try {
    const out = execFileSync("which", ["cmux-msg"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function safeIsSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isUsableDir(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return false;
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * symlink を atomic に張り替える (= 既存 unlink → symlink)。失敗時は false。
 */
function relinkAtomically(linkPath: string, targetPath: string): boolean {
  const tmp = `${linkPath}.cmuxmsg-${process.pid}.tmp`;
  try {
    fs.symlinkSync(targetPath, tmp);
    fs.renameSync(tmp, linkPath);
    return true;
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    return false;
  }
}

async function main(): Promise<void> {
  // stdin を捨てる (= 既存 session-start と同じ JSON が来るが、ここでは使わない)
  try {
    await Bun.stdin.text();
  } catch {
    // ignore
  }

  // hook 自身の realpath から plugin root → bin/cmux-msg を導出
  const hookRealpath = safeRealpath(import.meta.path);
  if (!hookRealpath) {
    process.exit(0);
  }
  // .../src/hooks/session-start-ensure-path.ts → .../bin/cmux-msg
  const pluginRoot = path.resolve(path.dirname(hookRealpath), "..", "..");
  const targetBin = path.join(pluginRoot, "bin", "cmux-msg");
  if (!fs.existsSync(targetBin)) {
    process.exit(0);
  }
  const targetBinRealpath = safeRealpath(targetBin) ?? targetBin;

  const pathBin = whichCmuxMsg();
  const pathBinRealpath = pathBin ? safeRealpath(pathBin) : null;
  const pathBinIsSymlink = pathBin ? safeIsSymlink(pathBin) : false;

  const decision = decidePathAction({
    targetBin: targetBinRealpath,
    pathBin,
    pathBinRealpath,
    pathBinIsSymlink,
  });

  // outdated-symlink は hook 自身が自動で張り替える
  if (decision.kind === "outdated-symlink") {
    const ok = relinkAtomically(pathBin!, targetBinRealpath);
    if (!ok) {
      // 張り替え失敗時は missing 扱いに落とし、AI に手動対応を促す
      const home = process.env.HOME ?? "";
      const candidates = home
        ? pickHomeBinCandidates(process.env.PATH ?? "", home, isUsableDir)
        : [];
      const msg = renderDecisionMessage(
        { kind: "missing", targetBin: targetBinRealpath },
        candidates,
      );
      if (msg) console.log(msg);
      process.exit(0);
    }
  }

  const home = process.env.HOME ?? "";
  const candidates =
    decision.kind === "missing" && home
      ? pickHomeBinCandidates(process.env.PATH ?? "", home, isUsableDir)
      : [];
  const msg = renderDecisionMessage(decision, candidates);
  if (msg) console.log(msg);
}

main().catch((e) => {
  const m = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[cmux-msg session-start-ensure-path hook error] ${m}\n`);
  process.exit(0);
});
