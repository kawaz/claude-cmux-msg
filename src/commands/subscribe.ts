import * as fs from "fs";
import * as path from "path";
import { watch, type FSWatcher } from "fs";
import { requireSessionId, getSessionId, myDir } from "../config";
import { listInbox, readMessage, type InboxMessage } from "../lib/inbox";
import { parseFrontmatter } from "../lib/frontmatter";
import {
  diffInbox,
  decideNotify,
  NOTIFY_CATCH_UP_SECONDS,
} from "../lib/subscribe";
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

/** notify text フィールドの最大サイズ (DR-0017: 64 KiB)。超過時は truncate。 */
const NOTIFY_TEXT_MAX_BYTES = 64 * 1024;

function truncateForPayload(body: string): string {
  // バイト基準で切る。UTF-8 マルチバイト境界で半端に切れると JSON 化時に
  // replacement char になりかねないので、超過時は単純な末尾削りで安全側に倒す。
  const enc = new TextEncoder();
  const bytes = enc.encode(body);
  if (bytes.length <= NOTIFY_TEXT_MAX_BYTES) return body;
  const truncated = bytes.slice(0, NOTIFY_TEXT_MAX_BYTES);
  // UTF-8 末尾の連続バイトを削って境界に合わせる
  let cut = truncated.length;
  while (cut > 0 && (truncated[cut - 1]! & 0xc0) === 0x80) cut--;
  const safe = new TextDecoder().decode(truncated.slice(0, cut));
  return safe + "...(truncated)";
}

/**
 * DR-0012 stage 1: subscribe を cmux wait-for から Bun fs.watch + DB lock + watermark に切替。
 *
 * - watcher: Bun fs.watch (macOS FSEvents、findings 2026-06-16 で rapid succession 耐性確認済)
 * - 二重起動防止: DB subscribers.lock_pid (= DR-0016 stage C)
 * - watermark: DB subscribers.watermark_id (= 再起動時 catch-up に使用)
 * - cmux daemon socket 不要 (= docs/issue/2026-06-17-subscribe-fails-without-daemon-socket の解消)
 */

/**
 * payload を JSONL で stdout に書く。
 *
 * event_type: 既存 send 経路は "send"、notify は "notify" (DR-0017)。
 * notify の場合は text フィールドに本文を同梱 (= 受信側 read 不要で即実行可)。
 * type フィールドは message_type を維持 (= 既存 consumer 後方互換)。
 */
function emit(msg: InboxMessage, text?: string): void {
  const payload: Record<string, unknown> = {
    filename: msg.filename,
    event_type: msg.type === "notify" ? "notify" : "send",
    from: msg.from,
    priority: msg.priority,
    type: msg.type,
    created_at: msg.created_at,
    in_reply_to: msg.in_reply_to,
  };
  if (msg.type === "notify") {
    payload.text = text === undefined ? "" : text;
  }
  process.stdout.write(JSON.stringify(payload) + "\n");
}

interface RescanCtx {
  db: Database | null;
  mySid: string;
  emitted: Set<string>;
  subscribeStartedAt: number;
  catchUpSeconds: number;
}

/**
 * notify file の body を inbox から読んで返す。読めなければ undefined。
 * unlink された file (= TTL 超過 lazy cleanup) の場合は undefined を返すだけで
 * emit 自体はスキップされる経路に流れる。
 */
function readNotifyBody(filename: string): string | undefined {
  try {
    const content = readMessage(filename);
    const { body } = parseFrontmatter(content);
    return truncateForPayload(body);
  } catch {
    return undefined;
  }
}

/**
 * notify file を inbox から削除 (DR-0018 lazy cleanup)。
 * 失敗しても致命ではない (次回 rescan で再試行)。
 */
function unlinkInboxFile(filename: string): void {
  try {
    fs.unlinkSync(path.join(myDir(), "inbox", filename));
  } catch {
    // 既に消されている / 権限なし等は無視
  }
}

function rescanAndEmit(ctx: RescanCtx): void {
  const current = listInbox();
  const d = diffInbox(ctx.emitted, current);

  // 実際に emit / watermark に乗せた最後の filename を後で記録
  let lastEmitted: string | null = null;
  const now = Date.now();
  // emitted set には「処理済み」を入れる (= emit / skip / unlink 後の再処理を防ぐ)
  const reallyProcessed = new Set<string>();

  for (const m of d.toEmit) {
    if (m.type === "notify") {
      const decision = decideNotify(
        Date.parse(m.created_at),
        now,
        ctx.subscribeStartedAt,
        ctx.catchUpSeconds,
      );
      if (decision === "emit") {
        const body = readNotifyBody(m.filename);
        emit(m, body);
        lastEmitted = m.filename;
        reallyProcessed.add(m.filename);
      } else if (decision === "unlink") {
        unlinkInboxFile(m.filename);
        reallyProcessed.add(m.filename);
      } else {
        // skip: 起動時 catch-up 窓外。stream には流さないが file は残し、
        // history から参照可能。emitted セットには入れる (= 同じ file を
        // 後続 rescan で再判定しない、起動中の場合は今後 catch-up と無関係)。
        reallyProcessed.add(m.filename);
      }
    } else {
      emit(m);
      lastEmitted = m.filename;
      reallyProcessed.add(m.filename);
    }
  }

  // diffInbox.nextEmitted は「current 全部」を返す (= accept/dismiss で
  // 消えたものは落とす)。それに今回処理分を merge する。
  const next = new Set<string>(d.nextEmitted);
  for (const f of reallyProcessed) next.add(f);
  ctx.emitted = next;

  if (ctx.db && lastEmitted) {
    try {
      setWatermark(ctx.db, ctx.mySid, lastEmitted);
    } catch {
      // watermark 失敗は致命的でない (= 次回起動で再 emit するだけ)
    }
  }
}


export async function cmdSubscribe(_args: string[]): Promise<void> {
  requireSessionId();

  // notify (DR-0018) 用 catch-up window は固定値 (60s)。
  // 既存 send 経路はこの window の影響を受けない (= 既存挙動維持)。
  const catchUpSeconds = NOTIFY_CATCH_UP_SECONDS;
  const subscribeStartedAt = Date.now();

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

  const ctx: RescanCtx = {
    db,
    mySid,
    emitted: new Set<string>(),
    subscribeStartedAt,
    catchUpSeconds,
  };

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
