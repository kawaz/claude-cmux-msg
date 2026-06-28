/**
 * SQLite error 判定ユーティリティ。
 *
 * bun:sqlite が throw する SQLiteError は code フィールドに
 * "SQLITE_BUSY" / "SQLITE_BUSY_SNAPSHOT" / "SQLITE_LOCKED" 等を持つ。
 * これらは「DB が usable な状態にあるが、lock 競合で書き込めなかった」状況を
 * 表すため、subscribe.ts の catch で「lock 取れなかった = 安全側 exit」に
 * 倒すための判定に使う。
 *
 * 一方、DB ファイル不在 / schema 不整合 / 旧来環境 (sessions row 不在) は
 * 別カテゴリで、subscribe を続行 (lock 無し fallback) すべき。
 */

export function isSqliteBusyError(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  // SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT / SQLITE_BUSY_RECOVERY / SQLITE_BUSY_TIMEOUT
  // / SQLITE_LOCKED / SQLITE_LOCKED_SHAREDCACHE を捕捉
  return code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED");
}
