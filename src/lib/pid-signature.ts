/**
 * PID 再利用 false-positive 対策の同名性 signature。
 *
 * 単純な `isProcessAlive(pid)` だけでは「死んだ subscribe の PID が別プロセス (shell 等)
 * に再利用された場合に alive=true になり、新 subscribe が永久に lock を奪取できない」
 * 誤判定が起きる。
 *
 * 対策: lock 取得時に PID の `lstart` (= プロセス開始時刻、`ps -o lstart`) を併せて
 * 記録し、生存判定時に PID alive + lstart 一致の AND で同名性を確認する。
 *
 * lstart は OS 提供の安定値で、PID 再利用が起きても元プロセスとは別の値になる。
 * これは DR-0007 の `lookupSidProcess` でも同等の同名性確認に使われている。
 *
 * Linux/macOS 共に `ps -o pid=,lstart= -p <pid>` で取得可能 (LC_ALL=C 前提)。
 */

import { execFileSync } from "child_process";

/** PID の lstart を取得。取れなければ null。 */
export function getPidLstart(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const out = execFileSync(
      "ps",
      ["-o", "lstart=", "-p", String(pid)],
      {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
      },
    ).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * lock holder が「自分と同名 (= 真の subscribe で PID 再利用ではない)」かを判定する純粋関数。
 *
 * 引数:
 *   - heldByAlive: holder PID が OS 上 alive か (= `process.kill(pid, 0)` 結果)
 *   - heldByLstart: holder PID の現在の lstart (取れなければ null)
 *   - recordedLstart: lock 取得時に DB に記録された lstart (null なら旧 row / lstart 取得失敗時)
 *
 * 戻り値:
 *   - "same"      : 同名 (奪取不可、二重起動防止が正しく発火)
 *   - "stale"     : holder dead または lstart 不一致 (奪取可能)
 *   - "unverified": recordedLstart が null (旧 row / ps 失敗で書かれた null) → lstart 検証できない
 *
 * 呼出側 (subscriber-state.tryAcquireLock) は **`unverified` を `stale` 扱いで
 * 奪取可能側に倒す**。理由は次の 2 点:
 *   - 旧 v1 schema (lstart 列不在) の row は古い deploy 環境のデータ。現プロセスは
 *     v2 schema を読み書きするので、上書きして lstart を記録し直す方が運用上自然
 *   - ps 失敗で recordedLstart=null が書かれたケースで「alive だが unverified」が
 *     永続化されると、再起動で永久 lock 取得不能になる事故が起きる。奪取可能側に
 *     倒すことで復旧経路を確保する
 *
 * 安全側に倒したい場合は呼出側で signature を渡さない (= sigOpts 未指定) ことで
 * 従来の alive-only 判定に戻せる。
 */
export type SignatureVerdict = "same" | "stale" | "unverified";

export function checkLockHolderSignature(input: {
  heldByAlive: boolean;
  heldByLstart: string | null;
  recordedLstart: string | null;
}): SignatureVerdict {
  if (!input.heldByAlive) return "stale";
  if (input.recordedLstart === null) return "unverified";
  if (input.heldByLstart === null) {
    // alive なのに lstart が取れない (= permission 等で ps 失敗): 安全側で同名扱い
    return "same";
  }
  return input.heldByLstart === input.recordedLstart ? "same" : "stale";
}
