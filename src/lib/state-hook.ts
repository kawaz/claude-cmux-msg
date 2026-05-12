/**
 * DR-0004: state 遷移系 hook (Stop / StopFailure / PermissionRequest / SessionEnd)
 * の共通ロジック。stdin から JSON を読み、session_id を抽出して
 * `transitionState(sid, target)` を呼ぶだけの薄いラッパー。
 *
 * 失敗は exit 0 で握りつぶす (フックは CC のターンを止めない)。
 */

import { transitionState } from "./state";
import { UUID_PATTERN } from "./validate";
import type { SessionState } from "../types";

interface HookInput {
  session_id?: string;
}

export async function runStateHook(target: SessionState): Promise<void> {
  // cmux 環境外 (CMUX_WORKSPACE_ID 未設定) では何もしない
  if (!process.env.CMUX_WORKSPACE_ID) return;

  let input: HookInput;
  try {
    const stdinText = await Bun.stdin.text();
    input = JSON.parse(stdinText);
  } catch {
    return;
  }

  const sid = input.session_id;
  if (!sid || !UUID_PATTERN.test(sid)) return;

  try {
    transitionState(sid, target);
  } catch {
    // meta 未存在 / 書き込み失敗は致命的ではない
  }
}
