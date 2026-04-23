import { requireCmux, getSessionId } from "../config";
import { listInbox, type InboxMessage } from "../lib/message";
import { cmuxWaitFor } from "../lib/cmux";
import { diffInbox } from "../lib/subscribe";

const WAIT_TIMEOUT_SEC = 3600;

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
      console.error(
        `cmux wait-for がエラー終了しました (exit=${r.exitCode}, ${elapsedSec}s):`
      );
      if (r.stderr) console.error(r.stderr);
      process.exit(1);
    }
    // received でも timeout でも inbox を再スキャン
    const current = listInbox();
    const d = diffInbox(emitted, current);
    for (const m of d.toEmit) emit(m);
    emitted = d.nextEmitted;
  }
}
