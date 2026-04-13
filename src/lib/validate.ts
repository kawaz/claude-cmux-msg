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

/** UUID v4 形式（cmux が CMUX_SURFACE_ID として採番） */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** cmux 内部参照（cmux API 用、cmux-msg のユーザ I/F では使わない） */
export const SURFACE_REF_PATTERN = /^surface:\d+$/;

/** surface ID バリデーション（UUID 形式のみ受付） */
export function validateSurfaceId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`UUID 形式が必要です: ${id}`);
  }
}

/** spawn名バリデーション（シェル安全な文字のみ） */
export function validateName(name: string): void {
  // 日本語も許可するが、シェルに危険な文字は禁止
  if (!name || /[;&|`$(){}\\!<>'"#\n\r]/.test(name)) {
    throw new Error(`不正な名前（シェル特殊文字を含む）: ${name}`);
  }
}
