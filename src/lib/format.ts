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

/** message.type の表示時 padding 長 (最も長い "broadcast" + `[]` ベース) */
export const TYPE_LABEL_WIDTH = "[broadcast]".length;
