import { requireCmux, getSessionId } from "../config";
import { listInbox, type InboxMessage } from "../lib/inbox";
import { cmuxWaitFor } from "../lib/cmux";
import { diffInbox } from "../lib/subscribe";

// cmux wait-for のタイムアウト。タイムアウト後は inbox を再スキャンして次の wait に入る。
// 環境変数 CMUXMSG_SUBSCRIBE_TIMEOUT (秒) で上書き可能。
const DEFAULT_WAIT_TIMEOUT_SEC = 3600;
const WAIT_TIMEOUT_SEC =
  parseInt(process.env.CMUXMSG_SUBSCRIBE_TIMEOUT || "", 10) ||
  DEFAULT_WAIT_TIMEOUT_SEC;

function emit(msg: InboxMessage): void {
  const line = JSON.stringify({
    filename: msg.filename,
    from: msg.from,
    priority: msg.priority,
    type: msg.type,
    created_at: msg.created_at,
    in_reply_to: msg.in_reply_to,
  });
  process.stdout.write(line + "\n");
}

export async function cmdSubscribe(_args: string[]): Promise<void> {
  requireCmux();

  // フォアグラウンド (TTY) 起動の警告。Monitor / pipe 経由なら isTTY=false。
  // subscribe は long-running blocking なので、CC の Bash ツールから叩くとハングする。
  if (process.stdout.isTTY) {
    process.stderr.write(
      "[warning] cmux-msg subscribe is a long-running blocking command.\n" +
      "[warning] In Claude Code, prefer launching it via the Monitor tool.\n" +
      "[warning] Press Ctrl-C to stop.\n"
    );
  }

  const mySessionId = getSessionId();
  const signal = `cmux-msg:${mySessionId}`;
  let emitted = new Set<string>();
  let running = true;

  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // 起動時の既存未読も含めて初回スキャン
  {
    const current = listInbox();
    const d = diffInbox(emitted, current);
    for (const m of d.toEmit) emit(m);
    emitted = d.nextEmitted;
  }

  while (running) {
    const r = await cmuxWaitFor(signal, WAIT_TIMEOUT_SEC);
    // SIGINT/SIGTERM 受信直後は cmux wait-for も死んで error 扱いになるため、
    // エラー判定より先に running チェック
    if (!running) break;
    if (r.kind === "error") {
      const elapsedSec = (r.elapsedMs / 1000).toFixed(2);
      // cli.ts 末尾の catch に任せる (二重防衛しない)
      throw new Error(
        `cmux wait-for がエラー終了しました (exit=${r.exitCode}, ${elapsedSec}s)` +
          (r.stderr ? `: ${r.stderr}` : "")
      );
    }
    // received でも timeout でも inbox を再スキャン
    const current = listInbox();
    const d = diffInbox(emitted, current);
    for (const m of d.toEmit) emit(m);
    emitted = d.nextEmitted;
  }
}
