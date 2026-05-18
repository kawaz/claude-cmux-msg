/**
 * peer session の cmux surface 解決 (DR-0007 決定2)
 *
 * cmux-msg の通信単位は claude session UUID だが、cmux API は `surface:N` を要求する。
 *
 * 旧実装は peer の meta.json に固定記録した `surface_ref` を読んでいたが、sid は
 * resume で別 surface / workspace へ移動するため固定記録は陳腐化する (DR-0007
 * 決定2)。本実装は次のチェーンで送り先 surface を**毎回動的に**決める:
 *
 *   sid → lookupSidProcess で claude プロセス → その controlling tty
 *       → resolveSurfaceByTty で cmux surface
 *
 * tty はプロセスが生きている限り不変なので、surface が移動しても追従できる。
 */
import { validateSessionId } from "./validate";
import { lookupSidProcess, type SidProcessLookup } from "./session-proc";
import { resolveSurfaceByTty, type SurfaceLookup } from "./cmux-surface";

/**
 * peer surface 解決の結果。surface が引けないケースを呼び出し側に区別して返す。
 *
 * - `found`: 送り先 surface (`surface:N`) と、その裏付けとなる proc lookup
 * - `not_found`: sid 照合 0 件 (プロセス不在 / dead)
 * - `ambiguous`: sid 照合 2 件以上 (並行 resume / 誤マッチ)
 * - `no_cmux_surface`: claude の tty に対応する cmux surface が無い
 * - `check_failed`: ps / cmux 問い合わせの失敗 (fail-closed)
 */
export type PeerSurfaceResolution =
  | {
      kind: "found";
      surfaceRef: string;
      /** found な proc lookup (pid / tty / fg / runState を含む)。 */
      proc: Extract<SidProcessLookup, { kind: "found" }>;
    }
  | { kind: "not_found" }
  | {
      kind: "ambiguous";
      procs: { pid: number; startTime: string }[];
    }
  | { kind: "no_cmux_surface" }
  | { kind: "check_failed"; error: string };

/**
 * sid → claude プロセス → tty → cmux surface を動的に逆引きする (DR-0007 決定2)。
 *
 * proc / surface 両方の lookup を組み合わせ、surface が引けないケース
 * (not_found / ambiguous / no_cmux_surface / check_failed) を区別して返す。
 * tell / screen / stop はこの結果を見て安全境界を判定する。
 */
export async function resolvePeerSurface(
  sessionId: string
): Promise<PeerSurfaceResolution> {
  validateSessionId(sessionId);

  const proc = lookupSidProcess(sessionId);
  if (proc.kind === "not_found") return { kind: "not_found" };
  if (proc.kind === "check_failed") {
    return { kind: "check_failed", error: proc.error };
  }
  if (proc.kind === "ambiguous") {
    return { kind: "ambiguous", procs: proc.procs };
  }

  const surface: SurfaceLookup = await resolveSurfaceByTty(proc.tty);
  switch (surface.kind) {
    case "found":
      return { kind: "found", surfaceRef: surface.surfaceRef, proc };
    case "no_surface":
      return { kind: "no_cmux_surface" };
    case "ambiguous":
      // tty が複数 surface にマッチ = 想定外。surface 不確定として扱う。
      return { kind: "no_cmux_surface" };
    case "check_failed":
      return { kind: "check_failed", error: surface.error };
  }
}

/**
 * peer の送り先 cmux surface (`surface:N`) を返す簡易版 (DR-0007 決定2)。
 *
 * surface が一意に引けない場合は理由を含む Error を throw する。
 * 拒否理由の細かい区別が必要な呼び出し側 (tell / screen) は `resolvePeerSurface`
 * を直接使うこと。stop など「引ければよい」用途向け。
 */
export async function resolvePeerSurfaceRef(
  sessionId: string
): Promise<string> {
  const r = await resolvePeerSurface(sessionId);
  switch (r.kind) {
    case "found":
      return r.surfaceRef;
    case "not_found":
      throw new Error(
        `session ${sessionId} の claude プロセスが見つかりません。` +
          `cmux-msg peers で確認してください。`
      );
    case "ambiguous": {
      const list = r.procs
        .map((p) => `pid=${p.pid} (lstart: ${p.startTime})`)
        .join(", ");
      throw new Error(
        `session ${sessionId} の claude が複数稼働しています: ${list}`
      );
    }
    case "no_cmux_surface":
      throw new Error(
        `session ${sessionId} の claude に対応する cmux surface が見つかりません ` +
          `(tmux 入れ子 / SSH 越し / ヘッドレス pty 等)。`
      );
    case "check_failed":
      throw new Error(
        `session ${sessionId} の surface 解決に失敗しました: ${r.error}`
      );
  }
}
