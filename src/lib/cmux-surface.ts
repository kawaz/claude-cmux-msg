/**
 * claude の controlling tty -> cmux surface の逆引き (DR-0007 決定2)
 *
 * `cmux tree` の出力は各 surface 行に `tty=ttysNNN` を持つ (tty を抱えている
 * surface のみ)。claude プロセスの controlling tty (session-proc の `tty`) を
 * 受け取り、その tty を抱える cmux surface (`surface:N`) を逆引きする。
 *
 * 見つからないケース (tmux 入れ子 / SSH 越し / ヘッドレス pty 等) は
 * DR-0007 の `no_cmux_surface` に対応する `kind: "no_surface"` で区別して返す。
 */

import { cmuxExec } from "./cmux";

/** `cmux tree` の 1 surface 行をパースした結果。 */
export interface CmuxSurfaceEntry {
  /** cmux surface 参照 (`surface:N`)。 */
  surfaceRef: string;
  /** その surface が抱える controlling tty (例: `ttys008`)。tty 表記が無ければ null。 */
  tty: string | null;
}

export type SurfaceLookup =
  | { kind: "found"; surfaceRef: string }
  | { kind: "no_surface" }
  | { kind: "ambiguous"; surfaceRefs: string[] }
  | { kind: "check_failed"; error: string };

/** surface 行から `surface surface:N` の参照部分を取り出す正規表現。 */
const SURFACE_REF_RE = /\bsurface\s+(surface:\d+)\b/;
/** surface 行末尾等に付く `tty=ttysNNN` を取り出す正規表現。 */
const TTY_RE = /\btty=(\S+)/;

/**
 * tty 文字列を正規化する。`ps -o tty` は `ttys008` の他に `s008` 形式や
 * `/dev/ttys008` を返す環境もあるため、basename を取り `tty` 接頭辞を補う。
 *
 * - `ttys008` -> `ttys008`
 * - `/dev/ttys008` -> `ttys008`
 * - `s008` -> `ttys008`
 * - `??` / 空 -> null (tty を持たない)
 */
export function normalizeTty(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === "" || t === "??" || t === "?") return null;
  // /dev/ttys008 -> ttys008
  const base = t.split("/").pop()!;
  if (base === "") return null;
  // `s008` のような ps 短縮表記 -> `ttys008`
  if (/^s\d+$/.test(base)) return `tty${base}`;
  return base;
}

/**
 * `cmux tree` の出力をパースし、surface 行を CmuxSurfaceEntry の配列にする (純粋関数)。
 *
 * surface 行の例:
 *   `        |__ surface surface:35 [terminal] "..." [selected] tty=ttys008`
 *   `        |__ surface surface:50 [terminal] "..."`  (tty 表記なし)
 *
 * `surface surface:N` を含まない行 (window / workspace / pane) は無視する。
 */
export function parseCmuxTree(raw: string): CmuxSurfaceEntry[] {
  const entries: CmuxSurfaceEntry[] = [];
  for (const line of raw.split("\n")) {
    const refMatch = line.match(SURFACE_REF_RE);
    if (!refMatch) continue;
    const surfaceRef = refMatch[1]!;
    const ttyMatch = line.match(TTY_RE);
    const tty = normalizeTty(ttyMatch ? ttyMatch[1] : null);
    entries.push({ surfaceRef, tty });
  }
  return entries;
}

/**
 * パース済み surface エントリ群から、指定 tty を抱える surface を引く (純粋関数)。
 *
 * - 0 件 -> no_surface (tmux 入れ子 / SSH / ヘッドレス pty 等)
 * - 1 件 -> found
 * - 2 件以上 -> ambiguous (通常起きないが fail-closed の判断材料として区別)
 *
 * tty 引数が tty を持たない値 (null / `??`) なら no_surface を返す。
 */
export function findSurfaceByTty(
  entries: CmuxSurfaceEntry[],
  tty: string | null | undefined
): SurfaceLookup {
  const target = normalizeTty(tty);
  if (target === null) return { kind: "no_surface" };
  const matched = entries.filter((e) => e.tty !== null && e.tty === target);
  if (matched.length === 0) return { kind: "no_surface" };
  if (matched.length > 1) {
    return {
      kind: "ambiguous",
      surfaceRefs: matched.map((e) => e.surfaceRef),
    };
  }
  return { kind: "found", surfaceRef: matched[0]!.surfaceRef };
}

/**
 * claude の controlling tty から cmux surface を逆引きする (DR-0007 決定2 の集約関数)。
 *
 * `cmux tree` を実行し parseCmuxTree -> findSurfaceByTty で判定する。
 * cmux の問い合わせ失敗・タイムアウトは check_failed (fail-closed、決定8)。
 */
export async function resolveSurfaceByTty(
  tty: string | null | undefined
): Promise<SurfaceLookup> {
  // tty を持たないなら cmux を叩くまでもなく no_surface
  if (normalizeTty(tty) === null) return { kind: "no_surface" };
  const result = await cmuxExec(["tree"]);
  if (result.exitCode !== 0) {
    return {
      kind: "check_failed",
      error: `cmux tree exited with code ${result.exitCode}${
        result.stderr ? `: ${result.stderr}` : ""
      }`,
    };
  }
  let entries: CmuxSurfaceEntry[];
  try {
    entries = parseCmuxTree(result.stdout);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "check_failed", error: `cmux tree parse failed: ${msg}` };
  }
  return findSurfaceByTty(entries, tty);
}
