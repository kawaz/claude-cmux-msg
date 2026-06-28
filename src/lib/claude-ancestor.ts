/**
 * 自プロセスの祖先 (= ppid chain) を辿って `claude` プロセスの pid を探す。
 *
 * issue 2026-06-24-detect-subscribe-false-negative-no-sid-flag への fallback。
 * `claude "<prompt>"` 形式で起動された claude は argv に `--session-id` を
 * 持たないため `lookupSidProcess` の argv 照合で false negative になる。
 * 一方で hook (SessionStart / UserPromptSubmit / check-subscribe) は
 * **必ず claude の子孫として起動される** ので、自プロセス → ppid → ppid → ...
 * と辿れば必ず claude プロセスに到達できる。
 *
 * I/O (`ps -axww`) は呼出側で行い、本 module は純粋関数として ppid map と
 * command map から chain を辿る判定だけを行う (テスト可能)。
 */

/** ps 1 行の最小フィールド (本 module の入力)。 */
export interface AncestorProcRow {
  pid: number;
  ppid: number;
  /** `ps -o command=` の生文字列 (argv を空白連結した表示文字列)。 */
  command: string;
}

/**
 * argv[0] (= command の先頭トークン) の basename が `claude` かを判定する。
 * `commandMatchesSid` の sid 照合を取り除いた版 (argv フラグ無関係)。
 */
export function isClaudeCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === "") return false;
  const argv0 = tokens[0]!;
  const base = argv0.split("/").pop();
  return base === "claude";
}

/**
 * `startPid` から ppid を辿り、basename = claude のプロセスを最初に見つけたら
 * その pid を返す。見つからなければ null。
 *
 * - PID 1 (init) は親不在として打ち切り
 * - `maxDepth` で循環 / 異常 ppid に対する打ち切り (デフォルト 16)
 */
export function findClaudeAncestor(
  rows: AncestorProcRow[],
  startPid: number,
  maxDepth = 16,
): number | null {
  // pid → row の lookup
  const byPid = new Map<number, AncestorProcRow>();
  for (const r of rows) byPid.set(r.pid, r);

  const seen = new Set<number>();
  let cur = startPid;
  for (let i = 0; i < maxDepth; i++) {
    if (cur <= 1) return null;
    if (seen.has(cur)) return null; // 循環防止
    seen.add(cur);
    const row = byPid.get(cur);
    if (!row) return null;
    if (isClaudeCommand(row.command)) return row.pid;
    cur = row.ppid;
  }
  return null;
}
