/**
 * subscribe --force: 既存 lock holder を kill して lock を奪うヘルパー。
 *
 * 方針:
 *   1. SIGTERM で停止依頼
 *   2. grace 期間 (デフォルト 5s) ポーリングで死亡待ち
 *   3. 残ってたら SIGKILL で強制終了
 *   4. 短く待って完全消滅を確認
 *
 * I/O (kill / sleep) は callback 注入で test 可能にする。
 */

export interface TakeoverOptions {
  pid: number;
  graceMs?: number;
  pollIntervalMs?: number;
  /** SIGTERM / SIGKILL を送る。失敗時 (= 既に dead 等) は false を返す。 */
  kill: (pid: number, signal: "SIGTERM" | "SIGKILL") => boolean;
  isAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
}

export type TakeoverOutcome =
  | { kind: "exited-on-term" }
  | { kind: "killed" }
  | { kind: "still-alive-after-kill" }
  | { kind: "already-dead" };

const DEFAULT_GRACE_MS = 5000;
const DEFAULT_POLL_MS = 100;
const POST_KILL_WAIT_MS = 200;

export async function forceTakeover(opts: TakeoverOptions): Promise<TakeoverOutcome> {
  const grace = opts.graceMs ?? DEFAULT_GRACE_MS;
  const poll = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  if (!opts.isAlive(opts.pid)) return { kind: "already-dead" };

  opts.kill(opts.pid, "SIGTERM");
  const deadline = grace;
  let elapsed = 0;
  while (elapsed < deadline) {
    await opts.sleep(poll);
    elapsed += poll;
    if (!opts.isAlive(opts.pid)) return { kind: "exited-on-term" };
  }

  // grace 経過後も alive → SIGKILL
  opts.kill(opts.pid, "SIGKILL");
  await opts.sleep(POST_KILL_WAIT_MS);
  if (!opts.isAlive(opts.pid)) return { kind: "killed" };
  return { kind: "still-alive-after-kill" };
}
