/**
 * tell / screen の安全境界の純粋判定ロジック (DR-0007 決定5/6/8/9)
 *
 * `lookupSidProcess` / `resolveSurfaceByTty` / `ps -p` 照合といった副作用は
 * 呼び出し側 (tell.ts / screen.ts) が行い、その結果 (SidProcessLookup /
 * SurfaceLookup / meta.state / text) を本モジュールの純粋関数に渡して
 * 「許可 / 拒否理由コード」を決める。これによりユニットテストで全分岐を
 * 網羅できる。
 */

import type {
  SidProcessLookup,
  RunState,
  PidRecheck,
} from "./session-proc";
import type { SurfaceLookup } from "./cmux-surface";

/**
 * tell / screen の拒否理由コード (DR-0007 決定5 の表)。
 *
 * - `not_found`: sid 照合 0 件 (プロセス不在 / dead)
 * - `cross_home`: 対象が別 claude_home。meta が読めず state 不明
 * - `ambiguous_concurrent_resume`: 照合 2 件以上、並行 resume 起因 (lstart 差で判別)
 * - `ambiguous_unexpected`: 照合 2 件以上、想定外 (誤マッチ疑い、改修検討対象)
 * - `no_cmux_surface`: claude の tty に対応する cmux surface が無い
 * - `background`: pgid≠tpgid
 * - `suspended` / `dead` / `unresponsive`: STAT 判定 (決定4)
 * - `busy`: meta.state が idle でない (tell のみ)
 * - `multiline`: text に改行・制御文字を含む (tell のみ)
 * - `check_failed`: ps / cmux 問い合わせの失敗 (決定8)
 */
export type DenyReason =
  | "not_found"
  | "cross_home"
  | "ambiguous_concurrent_resume"
  | "ambiguous_unexpected"
  | "no_cmux_surface"
  | "background"
  | "suspended"
  | "dead"
  | "unresponsive"
  | "busy"
  | "multiline"
  | "check_failed";

/** 衝突プロセス情報 (ambiguous 時に回復判断材料として渡す)。 */
export interface ConflictProc {
  pid: number;
  startTime: string;
}

/** 判定結果。allow なら送り先 surfaceRef と確定 pid 等を持つ。 */
export type GuardDecision =
  | {
      allow: true;
      /** 送り先 cmux surface 参照 (`surface:N`)。 */
      surfaceRef: string;
      /** 確定した claude プロセス pid (send 直前再照合に使う)。 */
      pid: number;
      /** 確定した claude プロセス起動時刻 (再照合の lstart 一致確認に使う)。 */
      startTime: string;
    }
  | {
      allow: false;
      reason: DenyReason;
      /** 人間向けの補足メッセージ (省略可)。 */
      detail?: string;
      /** ambiguous_* のときの衝突プロセス群。 */
      conflicts?: ConflictProc[];
    };

/**
 * 並行 resume か想定外かを lstart 差で判別する (DR-0007 決定5)。
 *
 * 並行 resume はユーザが同一 sid を別 surface で `claude --resume` した結果で、
 * 起動時刻 (lstart) が互いに異なる。すべてのプロセスが同一 lstart の場合は
 * 「同じ argv の別プロセスを誤マッチした」想定外ケースとして区別する。
 */
export function classifyAmbiguous(
  procs: ConflictProc[]
): "ambiguous_concurrent_resume" | "ambiguous_unexpected" {
  const distinct = new Set(procs.map((p) => p.startTime));
  return distinct.size > 1
    ? "ambiguous_concurrent_resume"
    : "ambiguous_unexpected";
}

/**
 * text が tell に適した 1 行のテキストか (DR-0007 決定5)。
 *
 * 改行・制御文字を含むと複数コマンドの即時実行になるため拒否する。
 * 許可するのは「改行 (\n, \r) と C0 制御文字を含まない」テキストのみ。
 * 通常の半角スペースとタブ以外の制御文字 (0x00-0x1F, 0x7F) を弾く。
 * タブ (0x09) も surface への意図しない補完トリガになりうるため拒否対象とする。
 */
export function isSingleLineText(text: string): boolean {
  // C0 制御文字 (0x00-0x1F) と DEL (0x7F) のいずれかを含めば不可。
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

/**
 * SidProcessLookup の kind に応じた拒否理由を返す。found なら null。
 */
function denyFromProcLookup(
  proc: SidProcessLookup
): { reason: DenyReason; detail?: string; conflicts?: ConflictProc[] } | null {
  switch (proc.kind) {
    case "not_found":
      return { reason: "not_found" };
    case "check_failed":
      return { reason: "check_failed", detail: proc.error };
    case "ambiguous": {
      const reason = classifyAmbiguous(proc.procs);
      const list = proc.procs
        .map((p) => `pid=${p.pid} (lstart: ${p.startTime})`)
        .join(", ");
      const detail =
        reason === "ambiguous_concurrent_resume"
          ? `同一 sid の claude が複数稼働しています (並行 resume)。古い方を kill して 1 つに収束させてください: ${list}`
          : `同一 sid の claude が複数マッチしました (想定外、誤マッチの疑い・改修検討対象): ${list}`;
      return { reason, detail, conflicts: proc.procs };
    }
    case "found":
      return null;
  }
}

/**
 * found な claude プロセスの fg / runState を検査する。問題なければ null。
 */
function denyFromProcState(proc: {
  isForeground: boolean;
  runState: RunState;
}): { reason: DenyReason; detail?: string } | null {
  if (proc.runState === "suspended") {
    return {
      reason: "suspended",
      detail:
        "対象 claude が suspend (Ctrl-Z 等) されています。fg に戻してから再試行してください。",
    };
  }
  if (proc.runState === "zombie") {
    return { reason: "dead", detail: "対象 claude プロセスは zombie です。" };
  }
  if (proc.runState === "unresponsive") {
    return {
      reason: "unresponsive",
      detail:
        "対象 claude が応答不能 (uninterruptible sleep) の可能性があります。",
    };
  }
  if (!proc.isForeground) {
    return {
      reason: "background",
      detail:
        "対象 claude は controlling tty の foreground process group にいません。",
    };
  }
  return null;
}

/**
 * SurfaceLookup の kind に応じた拒否理由を返す。found なら null。
 */
function denyFromSurfaceLookup(
  surface: SurfaceLookup
): { reason: DenyReason; detail?: string } | null {
  switch (surface.kind) {
    case "no_surface":
      return {
        reason: "no_cmux_surface",
        detail:
          "claude の tty に対応する cmux surface が見つかりません (tmux 入れ子 / SSH 越し / ヘッドレス pty 等)。",
      };
    case "check_failed":
      return { reason: "check_failed", detail: surface.error };
    case "ambiguous":
      return {
        reason: "no_cmux_surface",
        detail: `claude の tty が複数 surface にマッチしました (想定外): ${surface.surfaceRefs.join(", ")}`,
      };
    case "found":
      return null;
  }
}

/**
 * tell の許可判定 (DR-0007 決定5)。
 *
 * 全条件 (proc=found ちょうど 1 件 / surface 引けた / fg / running /
 * meta.state=idle / text が 1 行) を満たせば allow、満たさなければ
 * 区別された拒否理由を返す。
 *
 * @param proc       lookupSidProcess の結果
 * @param surface    resolveSurfaceByTty の結果 (proc=found のときのみ意味を持つ)
 * @param metaState  対象 meta.json の state。cross-home で読めない場合は null
 * @param crossHome  対象が別 claude_home か (true なら cross_home 扱い)
 * @param ignoreCrossHome  --ignore-cross-home 指定時 true。cross-home でも続行
 * @param text       送信テキスト
 */
export function evaluateTellGuard(params: {
  proc: SidProcessLookup;
  surface: SurfaceLookup;
  metaState: string | null;
  crossHome: boolean;
  ignoreCrossHome: boolean;
  text: string;
}): GuardDecision {
  const { proc, surface, metaState, crossHome, ignoreCrossHome, text } = params;

  // text の 1 行チェックは副作用がなく最優先で弾ける。
  if (!isSingleLineText(text)) {
    return {
      allow: false,
      reason: "multiline",
      detail:
        "text に改行または制御文字が含まれています。tell は 1 行のテキストのみ許可します。",
    };
  }

  const procDeny = denyFromProcLookup(proc);
  if (procDeny) return { allow: false, ...procDeny };
  if (proc.kind !== "found") {
    // 型ナローイング用 (denyFromProcLookup が null を返すのは found のみ)。
    return { allow: false, reason: "check_failed" };
  }

  const stateDeny = denyFromProcState(proc);
  if (stateDeny) return { allow: false, ...stateDeny };

  const surfaceDeny = denyFromSurfaceLookup(surface);
  if (surfaceDeny) return { allow: false, ...surfaceDeny };
  if (surface.kind !== "found") {
    return { allow: false, reason: "check_failed" };
  }

  // cross-home: meta が読めず state 不明。--ignore-cross-home でのみ続行。
  if (crossHome && !ignoreCrossHome) {
    return {
      allow: false,
      reason: "cross_home",
      detail:
        "対象 sid は別 claude_home です。state が確認できないため拒否しました。" +
        " リスクを承知で送るなら --ignore-cross-home を指定してください。",
    };
  }

  // state チェック: cross-home で ignore 指定時は metaState=null を許容する。
  if (!(crossHome && ignoreCrossHome)) {
    if (metaState !== "idle") {
      return {
        allow: false,
        reason: "busy",
        detail: `対象 sid は state=${metaState ?? "unknown"} です。tell は state=idle のときのみ許可します (awaiting_permission も不可)。`,
      };
    }
  }

  return {
    allow: true,
    surfaceRef: surface.surfaceRef,
    pid: proc.pid,
    startTime: proc.startTime,
  };
}

/**
 * send 直前再照合の判定結果 (DR-0007 決定6)。
 *
 * `ok` なら送信続行、それ以外は送信中止 (fail-closed)。
 */
export type RecheckDecision =
  | { ok: true }
  | { ok: false; reason: DenyReason; detail?: string };

/**
 * send 直前再照合の純粋判定 (DR-0007 決定6)。
 *
 * 初回照合で確定した pid / startTime / surfaceRef に対し、`recheckPidProcess`
 * の結果と「surface が再解決でも同一か」を渡し、「同一プロセスがまだ条件を
 * 満たし続けているか」を判定する。
 *
 * 中止条件 (fail-closed):
 *   - recheck が check_failed → check_failed
 *   - recheck が not_found → dead (プロセスが消えた)
 *   - startTime が初回と不一致 → dead (pid 再利用で別プロセスに化けた)
 *   - fg でなくなった → background
 *   - runState が running でない → suspended / dead / unresponsive
 *   - surface 再解決が found でない、または surfaceRef が初回と不一致
 *     → no_cmux_surface (送り先が動いた / 引けなくなった)
 *
 * @param expectedStartTime  初回照合時の startTime (lstart 一致確認用)
 * @param expectedSurfaceRef 初回照合時の送り先 surfaceRef
 * @param recheck            recheckPidProcess の結果
 * @param surface            送信直前に resolveSurfaceByTty で再取得した結果
 */
export function evaluateRecheck(params: {
  expectedStartTime: string;
  expectedSurfaceRef: string;
  recheck: PidRecheck;
  surface: SurfaceLookup;
}): RecheckDecision {
  const { expectedStartTime, expectedSurfaceRef, recheck, surface } = params;

  if (recheck.kind === "check_failed") {
    return { ok: false, reason: "check_failed", detail: recheck.error };
  }
  if (recheck.kind === "not_found") {
    return {
      ok: false,
      reason: "dead",
      detail: "再照合時に対象プロセスが消えていました。",
    };
  }
  // recheck.kind === "found"
  if (recheck.startTime !== expectedStartTime) {
    return {
      ok: false,
      reason: "dead",
      detail:
        "再照合で起動時刻が変化しました (pid 再利用で別プロセスに置き換わった可能性)。",
    };
  }
  const stateDeny = denyFromProcState(recheck);
  if (stateDeny) {
    return { ok: false, reason: stateDeny.reason, detail: stateDeny.detail };
  }
  // 送り先 surface の再確認。
  if (surface.kind === "check_failed") {
    return { ok: false, reason: "check_failed", detail: surface.error };
  }
  if (surface.kind !== "found") {
    return {
      ok: false,
      reason: "no_cmux_surface",
      detail: "再照合時に送り先 surface が引けなくなりました。",
    };
  }
  if (surface.surfaceRef !== expectedSurfaceRef) {
    return {
      ok: false,
      reason: "no_cmux_surface",
      detail: `再照合で送り先 surface が変化しました (${expectedSurfaceRef} → ${surface.surfaceRef})。`,
    };
  }
  return { ok: true };
}

/**
 * screen の許可判定 (DR-0007 決定5)。
 *
 * tell と異なり meta.state は**問わない** (running 中こそ画面読み取りが有用)。
 * text も無いので multiline チェックも無い。cross-home でも state を読まない
 * ので block しない (warning のみ、呼び出し側の責務)。
 *
 * 許可条件: proc=found ちょうど 1 件 / surface 引けた / fg / running。
 */
export function evaluateScreenGuard(params: {
  proc: SidProcessLookup;
  surface: SurfaceLookup;
}): GuardDecision {
  const { proc, surface } = params;

  const procDeny = denyFromProcLookup(proc);
  if (procDeny) return { allow: false, ...procDeny };
  if (proc.kind !== "found") {
    return { allow: false, reason: "check_failed" };
  }

  const stateDeny = denyFromProcState(proc);
  if (stateDeny) return { allow: false, ...stateDeny };

  const surfaceDeny = denyFromSurfaceLookup(surface);
  if (surfaceDeny) return { allow: false, ...surfaceDeny };
  if (surface.kind !== "found") {
    return { allow: false, reason: "check_failed" };
  }

  return {
    allow: true,
    surfaceRef: surface.surfaceRef,
    pid: proc.pid,
    startTime: proc.startTime,
  };
}
