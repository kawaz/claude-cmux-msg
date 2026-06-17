import * as path from "path";
import { watch, type FSWatcher } from "fs";
import { requireSessionId, getSessionId, myDir } from "../config";
import { listInbox, type InboxMessage } from "../lib/inbox";
import { diffInbox } from "../lib/subscribe";
import { pickStableCwd } from "../lib/paths";
import { openDb } from "../lib/db";
import {
  tryAcquireLock,
  releaseLock,
  getWatermark,
  setWatermark,
} from "../lib/subscriber-state";
import { isProcessAlive } from "../lib/peer";
import type { Database } from "bun:sqlite";

/**
 * DR-0012 stage 1: subscribe を cmux wait-for から Bun fs.watch + DB lock + watermark に切替。
 *
 * - watcher: Bun fs.watch (macOS FSEvents、findings 2026-06-16 で rapid succession 耐性確認済)
 * - 二重起動防止: DB subscribers.lock_pid (= DR-0016 stage C)
 * - watermark: DB subscribers.watermark_id (= 再起動時 catch-up に使用)
 * - cmux daemon socket 不要 (= docs/issue/2026-06-17-subscribe-fails-without-daemon-socket の解消)
 */

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

interface RescanCtx {
  db: Database | null;
  mySid: string;
  emitted: Set<string>;
}

function rescanAndEmit(ctx: RescanCtx): void {
  const current = listInbox();
  const d = diffInbox(ctx.emitted, current);
  for (const m of d.toEmit) emit(m);
  ctx.emitted = d.nextEmitted;
  if (ctx.db && d.toEmit.length > 0) {
    const last = d.toEmit[d.toEmit.length - 1]!.filename;
    try {
      setWatermark(ctx.db, ctx.mySid, last);
    } catch {
      // watermark 失敗は致命的でない (= 次回起動で再 emit するだけ)
    }
  }
}

export async function cmdSubscribe(_args: string[]): Promise<void> {
  requireSessionId();

  // cwd 削除耐性 (= worktree 等が消えても subscribe を落とさない)
  try {
    process.chdir(pickStableCwd());
  } catch {
    // chdir 失敗は致命ではない
  }

  if (process.stdout.isTTY) {
    process.stderr.write(
      "[warning] cmux-msg subscribe is a long-running blocking command.\n" +
        "[warning] In Claude Code, prefer launching it via the Monitor tool.\n" +
        "[warning] plugin update 後は Monitor を一度停止 → /reload-plugins → 再起動してください。\n" +
        "[warning] Press Ctrl-C to stop.\n",
    );
  }

  const mySid = getSessionId();
  const myPid = process.pid;

  // DR-0016 stage C: 二重起動防止 lock を DB で取る。DB / sessions row が
  // 無い場合 (= 旧来環境、SessionStart hook 未走行) は lock なしで継続。
  let db: Database | null = null;
  let lockAcquired = false;
  try {
    db = openDb();
    lockAcquired = tryAcquireLock(db, mySid, myPid, (pid) =>
      isProcessAlive(pid),
    );
    if (!lockAcquired) {
      process.stderr.write(
        "[error] subscribe lock を取得できませんでした (= 他プロセスが既に subscribe を保持中)。終了します。\n",
      );
      db.close();
      process.exit(1);
    }
  } catch (e) {
    // DB 未初期化 / sessions row 不在 → lock なしで続行 (= 旧 file 経路だけで動作)
    if (db) {
      try {
        db.close();
      } catch {}
    }
    db = null;
    process.stderr.write(
      `[warning] subscribe DB lock skipped: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }

  const ctx: RescanCtx = { db, mySid, emitted: new Set<string>() };

  // 起動時の catch-up: watermark より前の file は emit 済み扱いにして抑制
  if (db) {
    try {
      const wm = getWatermark(db, mySid);
      if (wm) {
        for (const m of listInbox()) {
          if (m.filename <= wm) ctx.emitted.add(m.filename);
        }
      }
    } catch {
      // watermark 取れなければ全件 emit (= 安全側)
    }
  }
  rescanAndEmit(ctx);

  // Bun fs.watch で inbox を監視。recursive false (= 直下のみ、十分)。
  const inboxDir = path.join(myDir(), "inbox");
  let running = true;
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(inboxDir, () => {
      if (!running) return;
      try {
        rescanAndEmit(ctx);
      } catch {
        // 個別 event の処理失敗は致命ではない
      }
    });
  } catch (e) {
    process.stderr.write(
      `[error] inbox 監視を起動できません (${inboxDir}): ${e instanceof Error ? e.message : String(e)}\n` +
        `[hint] まず \`cmux-msg init\` で受信箱を初期化してください。\n`,
    );
    if (db && lockAcquired) {
      try {
        releaseLock(db, mySid, myPid);
      } catch {}
      db.close();
    }
    process.exit(1);
  }

  const stop = () => {
    running = false;
    if (watcher) {
      try {
        watcher.close();
      } catch {}
    }
    if (db && lockAcquired) {
      try {
        releaseLock(db, mySid, myPid);
      } catch {}
      try {
        db.close();
      } catch {}
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // event 駆動なので「ループ」は不要、running flag が落ちるまで Promise で待つ。
  // 軽量 tick (= 1s poll) は (a) running を監視、(b) 万一 watch event が間引かれた
  // 場合の保険 poll を兼ねる (FSEvents の coalesce ~200ms 救済、findings 2026-06-16)。
  await new Promise<void>((resolve) => {
    const POLL_MS = 1000;
    const tick = () => {
      if (!running) {
        resolve();
        return;
      }
      try {
        rescanAndEmit(ctx);
      } catch {
        // 個別 tick の失敗は致命ではない
      }
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  });
}
