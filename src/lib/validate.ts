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

/** UUID v4 形式（claude --session-id で採番） */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** cmux 内部参照（cmux API 用、cmux-msg のユーザ I/F では使わない） */
export const SURFACE_REF_PATTERN = /^surface:\d+$/;

/** session ID バリデーション（UUID 形式のみ受付） */
export function validateSessionId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`session_id は UUID 形式が必要です: ${id}`);
  }
}

/**
 * workspace ディレクトリ内のエントリ名が session ID か判定する。
 * `broadcast`、`by-surface`、`.last-worker-surface` 等のインデックス／内部状態
 * ディレクトリを peer 列挙から弾くために使う。
 */
export function isSessionId(name: string): boolean {
  return UUID_PATTERN.test(name);
}

/** spawn名バリデーション（shell-safe な文字に厳格に絞る） */
export function validateName(name: string): void {
  // 環境変数代入とコマンドラインに安全な文字に限定。
  // ASCII 英数字 + `_` + `-` のみ。スペース・記号・日本語は禁止。
  // 旧実装は「シェル特殊文字を弾く」ブラックリストだったが、shell の単語分割や
  // ロケール起因の挙動も考えるとホワイトリストの方が確実。
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `不正な名前 (英数字, '_', '-' のみ可): ${JSON.stringify(name)}`
    );
  }
}

/**
 * 値を bash 単引用符でクォートする (内部の `'` をエスケープ)。
 * 環境変数代入やコマンド引数の展開先で安全に使える。
 */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
