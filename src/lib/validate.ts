/**
 * 入力バリデーション（セキュリティ）
 */

import * as path from "path";

/** ファイル名バリデーション（パストラバーサル防止） */
export function validateFilename(filename: string): void {
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("..") ||
    filename.includes(path.sep) ||
    filename.includes("\0")
  ) {
    throw new Error(`不正なファイル名: ${filename}`);
  }
}

/** surface ID バリデーション（UUID形式 or surface:N 形式） */
export function validateSurfaceId(id: string): void {
  const uuidPattern = /^[0-9a-fA-F-]+$/;
  const refPattern = /^surface:\d+$/;
  if (!uuidPattern.test(id) && !refPattern.test(id)) {
    throw new Error(`不正な surface ID: ${id}`);
  }
}

/** spawn名バリデーション（シェル安全な文字のみ） */
export function validateName(name: string): void {
  // 日本語も許可するが、シェルに危険な文字は禁止
  if (!name || /[;&|`$(){}\\!<>'"#\n\r]/.test(name)) {
    throw new Error(`不正な名前（シェル特殊文字を含む）: ${name}`);
  }
}
