/**
 * sid → claude プロセス情報の照合 (DR-0007 決定1/3/4/11)
 *
 * `ps -axww -o pid,ppid,pgid,tpgid,stat,tty,lstart,command` を実行し、
 * 対象 session_id (UUID) の claude プロセスを引く。
 *
 * 照合条件 (独立に AND):
 *   - argv[0] (パス) の末尾要素が `claude`
 *   - argv に `--session-id` または `--resume` フラグがあり、その直後トークンが対象 UUID
 *
 * ヒット数は「マッチしたプロセス (行) 数」で数える。`stat` のパースは本モジュールに
 * 閉じ、生 stat 文字列を呼び出し側へ返さない (DR-0007 決定11)。
 */

import { UUID_PATTERN } from "./validate";

/** ps 1 行を構造化したもの。lstart は 5 トークンを連結した文字列 (LC_ALL=C 前提)。 */
export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
  tpgid: number;
  stat: string;
  tty: string;
  /** ps -o lstart= 相当の起動時刻文字列 (例: `Sun May 18 10:48:47 2026`)。 */
  startTime: string;
  /** command 列の生文字列 (argv を空白連結した表示文字列)。 */
  command: string;
}

export type RunState = "running" | "suspended" | "zombie" | "unresponsive";

export type SidProcessLookup =
  | {
      kind: "found";
      pid: number;
      tty: string;
      pgid: number;
      tpgid: number;
      startTime: string;
      isForeground: boolean;
      runState: RunState;
    }
  | { kind: "not_found" }
  | { kind: "ambiguous"; procs: { pid: number; startTime: string }[] }
  | { kind: "check_failed"; error: string };

/**
 * STAT 文字列 → 正規化された runState (DR-0007 決定4)。
 *
 * - `T` を含む → suspended (Ctrl-Z 等)
 * - 1 文字目 `Z` → zombie
 * - 1 文字目 `U` / `D` → unresponsive (uninterruptible sleep)
 * - それ以外 → running
 *
 * `T` の判定を 1 文字目だけでなく文字列全体で見るのは、理論上の `T+` 等の
 * 修飾フラグ付き stopped を取りこぼさないため (findings の防御方針)。
 */
export function parseRunState(stat: string): RunState {
  const s = stat.trim();
  if (s.includes("T")) return "suspended";
  const first = s.charAt(0);
  if (first === "Z") return "zombie";
  if (first === "U" || first === "D") return "unresponsive";
  return "running";
}

/**
 * `ps -axww -o pid,ppid,pgid,tpgid,stat,tty,lstart,command` の出力全体をパースする。
 *
 * - 先頭のヘッダ行 (`PID  PPID ...`) はスキップする
 * - lstart は曜日名・月名を含む固定 5 トークン (`Day Mon DD HH:MM:SS YYYY`)。
 *   LC_ALL=C を前提に英語表記としてパースするが、値の意味解釈はせず文字列のまま保持する
 * - 数値列のパースに失敗した行はスキップする (claude 照合に使えないため)
 */
export function parsePsOutput(raw: string): PsRow[] {
  const rows: PsRow[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    // 先頭固定 6 列 + lstart 5 トークン + command (残り全部)。
    // command は空白を含むので split せず、先頭 11 トークンだけ取り出して残りを連結する。
    const tokens = line.trimStart().split(/\s+/);
    if (tokens.length < 12) continue;
    // ヘッダ行スキップ (PID 列が数値でない)
    const pid = Number(tokens[0]);
    if (!Number.isInteger(pid)) continue;
    const ppid = Number(tokens[1]);
    const pgid = Number(tokens[2]);
    const tpgid = Number(tokens[3]);
    if (
      !Number.isInteger(ppid) ||
      !Number.isInteger(pgid) ||
      !Number.isInteger(tpgid)
    ) {
      continue;
    }
    const stat = tokens[4]!;
    const tty = tokens[5]!;
    // lstart は tokens[6..10] の 5 トークン
    const startTime = tokens.slice(6, 11).join(" ");
    // command は tokens[11] 以降。元行から先頭 11 トークン分を取り除いて復元する
    // (command 内部の連続空白を 1 個に潰さないため、正規表現で位置を特定する)。
    const command = extractCommand(line, tokens.slice(0, 11));
    rows.push({ pid, ppid, pgid, tpgid, stat, tty, startTime, command });
  }
  return rows;
}

/**
 * 行から先頭 11 トークン (pid..lstart) を取り除いた残り = command を取り出す。
 * 先頭トークンを順に消費し、その後の先頭空白を 1 回だけ trim する。
 */
function extractCommand(line: string, leadingTokens: string[]): string {
  let rest = line.trimStart();
  for (const tok of leadingTokens) {
    const idx = rest.indexOf(tok);
    if (idx < 0) {
      // 想定外。安全側で空文字を返す。
      return "";
    }
    rest = rest.slice(idx + tok.length).trimStart();
  }
  return rest;
}

/**
 * command 表示文字列が「対象 UUID の claude プロセス」かを判定する (DR-0007 決定1)。
 *
 * 独立に AND:
 *   - argv[0] (空白区切り先頭トークン) の basename が `claude`
 *   - `--session-id` または `--resume` の直後トークンが対象 UUID
 *
 * `ps command` は argv 境界を保持しない表示文字列なので「直後トークン」判定は
 * 空白 split に基づくベストエフォート。findings で「正規運用では誤認なし」を
 * 確認済み。曖昧さはヒット数 1 要件 + fail-closed で吸収する。
 */
export function commandMatchesSid(command: string, sid: string): boolean {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === "") return false;
  // argv[0] の basename
  const argv0 = tokens[0]!;
  const base = argv0.split("/").pop();
  if (base !== "claude") return false;
  const sidLower = sid.toLowerCase();
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t === "--session-id" || t === "--resume") {
      const next = tokens[i + 1]!;
      if (
        UUID_PATTERN.test(next) &&
        next.toLowerCase() === sidLower
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * パース済み PsRow 群から対象 sid の claude プロセスを引き、SidProcessLookup を返す。
 * (ps の実行は別、本関数は純粋。テスト可能。)
 *
 * - 0 件 → not_found
 * - 1 件 → found (isForeground / runState を正規化して返す)
 * - 2 件以上 → ambiguous (衝突 pid + startTime を併記)
 */
export function resolveSidFromPsRows(
  rows: PsRow[],
  sid: string
): SidProcessLookup {
  const matched = rows.filter((r) => commandMatchesSid(r.command, sid));
  if (matched.length === 0) return { kind: "not_found" };
  if (matched.length > 1) {
    return {
      kind: "ambiguous",
      procs: matched.map((r) => ({ pid: r.pid, startTime: r.startTime })),
    };
  }
  const r = matched[0]!;
  return {
    kind: "found",
    pid: r.pid,
    tty: r.tty,
    pgid: r.pgid,
    tpgid: r.tpgid,
    startTime: r.startTime,
    isForeground: r.pgid === r.tpgid,
    runState: parseRunState(r.stat),
  };
}

/** ps コマンドのタイムアウト (ミリ秒)。DR-0007 決定8 の初期値。 */
const PS_TIMEOUT_MS = 5000;

/**
 * 確定済み pid に対する軽量な再照合結果 (DR-0007 決定6 send 直前再照合)。
 *
 * - `found`: そのプロセスが今も生きており fg / runState / startTime を取得できた
 * - `not_found`: pid 指定の ps が 0 件 (プロセスが終了した)
 * - `check_failed`: ps の異常終了・タイムアウト・パース不能 (fail-closed)
 */
export type PidRecheck =
  | {
      kind: "found";
      pid: number;
      tty: string;
      pgid: number;
      tpgid: number;
      startTime: string;
      isForeground: boolean;
      runState: RunState;
    }
  | { kind: "not_found" }
  | { kind: "check_failed"; error: string };

/**
 * 確定済み pid を `ps -p <pid> -o pgid,tpgid,tty,stat,lstart` で再照会する
 * (DR-0007 決定6)。argv パース不要・軽量。send 直前に「同一プロセスがまだ
 * 条件を保ち続けているか (lstart 一致・fg 維持)」を確認するために使う。
 *
 * `LC_ALL=C` を強制し lstart をロケール非依存表記で得る。
 * ps の異常終了・タイムアウト・パース不能は check_failed (fail-closed)。
 */
export function recheckPidProcess(pid: number): PidRecheck {
  let raw: string;
  try {
    const proc = Bun.spawnSync({
      cmd: ["ps", "-p", String(pid), "-o", "pid,pgid,tpgid,tty,stat,lstart"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: PS_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    // `ps -p <pid>` はプロセス不在のとき exitCode 1 (stdout はヘッダのみ or 空)。
    // これは「プロセスが終了した」= not_found であって check_failed ではない。
    if (proc.exitCode !== 0) {
      const out = new TextDecoder().decode(proc.stdout);
      const dataLines = out
        .split("\n")
        .filter((l) => l.trim() !== "")
        .filter((l) => Number.isInteger(Number(l.trimStart().split(/\s+/)[0])));
      if (dataLines.length === 0) return { kind: "not_found" };
      // exitCode≠0 だがデータ行がある = 想定外。fail-closed。
      const err = new TextDecoder().decode(proc.stderr).trim();
      return {
        kind: "check_failed",
        error: `ps -p exited with code ${proc.exitCode}${err ? `: ${err}` : ""}`,
      };
    }
    raw = new TextDecoder().decode(proc.stdout);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "check_failed", error: `ps -p execution failed: ${msg}` };
  }
  // データ行 (ヘッダを除く) を 1 行抽出する。
  // 列順: pid pgid tpgid tty stat lstart(5 トークン)
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const tokens = line.trimStart().split(/\s+/);
    const linePid = Number(tokens[0]);
    if (!Number.isInteger(linePid)) continue; // ヘッダ行
    if (tokens.length < 10) {
      return { kind: "check_failed", error: `ps -p output malformed` };
    }
    const pgid = Number(tokens[1]);
    const tpgid = Number(tokens[2]);
    const tty = tokens[3]!;
    const stat = tokens[4]!;
    const startTime = tokens.slice(5, 10).join(" ");
    if (!Number.isInteger(pgid) || !Number.isInteger(tpgid)) {
      return { kind: "check_failed", error: `ps -p numeric parse failed` };
    }
    return {
      kind: "found",
      pid: linePid,
      tty,
      pgid,
      tpgid,
      startTime,
      isForeground: pgid === tpgid,
      runState: parseRunState(stat),
    };
  }
  // exitCode 0 だがデータ行が無い = プロセスは消えた。
  return { kind: "not_found" };
}

/**
 * sid → claude プロセス情報を引く (DR-0007 決定1/3/4/11 の集約関数)。
 *
 * `ps -axww` を実行し parsePsOutput → resolveSidFromPsRows で判定する。
 * ps の異常終了・タイムアウト・パース不能は check_failed (fail-closed、決定8)。
 *
 * `LC_ALL=C` を強制し、lstart 列をロケール非依存の英語表記で得る。
 */
export function lookupSidProcess(sid: string): SidProcessLookup {
  let raw: string;
  try {
    const proc = Bun.spawnSync({
      cmd: [
        "ps",
        "-axww",
        "-o",
        "pid,ppid,pgid,tpgid,stat,tty,lstart,command",
      ],
      stdout: "pipe",
      stderr: "pipe",
      timeout: PS_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    if (proc.exitCode !== 0) {
      const err = new TextDecoder().decode(proc.stderr).trim();
      return {
        kind: "check_failed",
        error: `ps exited with code ${proc.exitCode}${err ? `: ${err}` : ""}`,
      };
    }
    raw = new TextDecoder().decode(proc.stdout);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "check_failed", error: `ps execution failed: ${msg}` };
  }
  let rows: PsRow[];
  try {
    rows = parsePsOutput(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "check_failed", error: `ps output parse failed: ${msg}` };
  }
  return resolveSidFromPsRows(rows, sid);
}
