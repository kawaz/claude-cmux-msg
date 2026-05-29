/**
 * CLI 出力の整形ヘルパ。
 */

import { UUID_PATTERN } from "./validate";

/**
 * UUID 形式の ID を読みやすく短縮する (先頭 8 文字)。それ以外はそのまま返す。
 * 例: `f695cacc-14c6-4983-94af-d3eeb1d6649a` → `f695cacc`
 */
export function shortId(id: string): string {
  if (UUID_PATTERN.test(id)) return id.slice(0, 8);
  return id;
}

/**
 * メッセージ filename (`YYYYMMDDTHHMMSS-<8hex>.md`) から 8 文字の id 部分のみ抽出。
 * thread_id 表示等で「短い識別子」が欲しい時に使う。
 * パターン不一致なら filename そのまま (= 安全側、id 推測しない)。
 * 例: `20260527T021810-a97350d4.md` → `a97350d4`
 */
export function messageShortId(filename: string): string {
  const m = filename.match(/-([0-9a-f]{8})\.md$/);
  return m ? m[1]! : filename;
}

/** message.type の表示時 padding 長 (最も長い "broadcast" + `[]` ベース) */
export const TYPE_LABEL_WIDTH = "[broadcast]".length;
