/**
 * tell / screen の拒否イベントを観測ログに記録する (DR-0007「観測性」節)。
 *
 * `tell` / `screen` が安全境界で送信/読み取りを拒否したとき、その事実を
 * 1 イベント = 1 行 JSONL でファイルに追記する。これにより
 * `ambiguous_*` / `check_failed` の発生頻度を後から追え、「並行 resume は稀」
 * 「check_failed は散発」という DR-0007 の前提が実態と合うか検証できる。
 *
 * 許可されて送信成功したケースは記録しない (拒否イベントのみ)。
 *
 * Design rationale: ログのローテーション / サイズ上限は本スコープ外。
 * 追記のみで、サイズ管理は将来別 issue とする (dogfood 規模では拒否イベントの
 * 発生頻度が低く、当面の肥大化リスクは小さいため)。
 */

import * as fs from "fs";
import * as path from "path";
import { getMsgBase } from "./paths";
import type { DenyReason } from "./tell-guard";

/** 拒否イベント 1 件。`buildDenyLogLine` で JSONL 1 行に直列化する。 */
export interface DenyEvent {
  /** ISO 8601 形式のタイムスタンプ (timezone offset 付き)。 */
  timestamp: string;
  /** 操作種別。 */
  operation: "tell" | "screen";
  /** 拒否対象の session_id。 */
  sessionId: string;
  /** 拒否理由コード (DR-0007 決定5)。 */
  reason: DenyReason;
  /**
   * 関連 pid。単一プロセスなら 1 要素、`ambiguous_*` なら衝突した
   * プロセス群。不明 / 該当なしのときは省略。
   */
  pids?: number[];
  /** 人間向けの簡潔な詳細メッセージ (省略可)。 */
  detail?: string;
}

/**
 * 拒否イベントを JSONL 1 行に直列化する純粋関数。
 *
 * - `detail` は省略時にフィールドを含めない
 * - `pids` は省略時 / 空配列のときフィールドを含めない
 * - 戻り値に末尾改行は含まない (追記側で付与する)
 */
export function buildDenyLogLine(event: DenyEvent): string {
  const record: Record<string, unknown> = {
    timestamp: event.timestamp,
    operation: event.operation,
    session_id: event.sessionId,
    reason: event.reason,
  };
  if (event.pids && event.pids.length > 0) record.pids = event.pids;
  if (event.detail !== undefined) record.detail = event.detail;
  return JSON.stringify(record);
}

/** 拒否イベントログのファイルパス (`<base>/logs/deny.jsonl`)。 */
export function denyLogPath(): string {
  return path.join(getMsgBase(), "logs", "deny.jsonl");
}

/**
 * 拒否イベントを `<base>/logs/deny.jsonl` に 1 行追記する。
 *
 * `logs` ディレクトリが無ければ作る。書き込み失敗 (権限・ディスク等) は
 * **握り潰す** — ログ記録の失敗で tell / screen 本体を落とさないため
 * (DR-0007 観測性節 / 方針4)。`appendFileSync` は追記オープンなので
 * 単一行の追記は原子的に行われる。
 */
export function logDenyEvent(event: DenyEvent): void {
  try {
    const p = denyLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, buildDenyLogLine(event) + "\n");
  } catch {
    // ログのために本体を落とさない。失敗は黙って無視する。
  }
}
