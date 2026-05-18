import { requireCmux } from "../config";
import { cmuxSend, cmuxSendKey } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { lookupSidProcess, recheckPidProcess } from "../lib/session-proc";
import { resolveSurfaceByTty } from "../lib/cmux-surface";
import { readMetaBySid } from "../lib/meta";
import { getClaudeHome } from "../config";
import {
  evaluateTellGuard,
  evaluateRecheck,
  type DenyReason,
} from "../lib/tell-guard";

/**
 * DR-0007: tell の安全境界 (決定2/5/6/8/9)。
 *
 * `tell <sid> <text>` は対象 claude の cmux surface にキー入力を注入する。
 * 誤った相手への注入を防ぐため、次を全て満たすときのみ送信する:
 *
 *   - sid 照合がちょうど 1 件 (`lookupSidProcess`)
 *   - claude の tty → cmux surface 逆引きが成功 (`resolveSurfaceByTty`)
 *   - claude が controlling tty の foreground process group にいる (pgid==tpgid)
 *   - claude の runState が running (suspended / zombie / unresponsive は拒否)
 *   - 対象 meta.state が idle (awaiting_permission は不可、DR-0007 決定5)
 *   - text が改行・制御文字を含まない 1 行
 *
 * 上記通過後、`cmuxSend` 直前に確定 pid を `ps -p` で再照合し、同一プロセスが
 * まだ条件を保ち続けているかを確認する (DR-0007 決定6 / fail-closed)。
 *
 * cross-home (対象が別 claude_home で meta が読めず state 不明) は block せず
 * warning とし、`--ignore-cross-home` 指定時のみ続行する (DR-0005 / 決定9)。
 * `--force` は意図が曖昧なため設けない。
 */
export async function cmdTell(args: string[]): Promise<void> {
  requireCmux();

  // --ignore-cross-home フラグを抽出 (位置非依存)。
  const ignoreCrossHome = args.includes("--ignore-cross-home");
  const rest = args.filter((a) => a !== "--ignore-cross-home");

  if (rest.length < 2) {
    console.error(
      "使い方: cmux-msg tell <session_id> <テキスト> [--ignore-cross-home]"
    );
    process.exit(1);
  }

  const sessionId = rest[0]!;
  validateSessionId(sessionId);
  const text = rest.slice(1).join(" ");

  // proc / surface / meta を引く (副作用)。
  const proc = lookupSidProcess(sessionId);
  // surface は proc=found のときのみ意味を持つ。found 以外は no_surface 相当の
  // ダミーを渡して evaluateTellGuard 側の proc 拒否を先に成立させる。
  const surface =
    proc.kind === "found"
      ? await resolveSurfaceByTty(proc.tty)
      : ({ kind: "no_surface" } as const);

  const meta = readMetaBySid(sessionId);
  // cross-home 判定: proc は生きている (found) のに meta が自分の base に無い
  // = 対象 sid は別 claude_home。meta があっても claude_home が違えば cross-home。
  const selfHome = getClaudeHome();
  const crossHome =
    proc.kind === "found" &&
    (meta === null || meta.claude_home !== selfHome);
  const metaState = meta ? meta.state : null;

  if (crossHome) {
    process.stderr.write(
      `[warning] session ${sessionId} は別の claude_home です (state 不明)。\n` +
        (meta
          ? `  peer: ${meta.claude_home}\n  self: ${selfHome}\n`
          : `  meta.json が自分の base に見つかりません。\n`)
    );
  }

  const decision = evaluateTellGuard({
    proc,
    surface,
    metaState,
    crossHome,
    ignoreCrossHome,
    text,
  });

  if (!decision.allow) {
    reportDeny(sessionId, decision.reason, decision.detail);
    process.exit(1);
  }

  // --- DR-0007 決定6: send 直前再照合 (TOCTOU 緩和、fail-closed) ---
  const recheck = recheckPidProcess(decision.pid);
  const surfaceRecheck = await resolveSurfaceByTty(
    recheck.kind === "found" ? recheck.tty : null
  );
  const recheckDecision = evaluateRecheck({
    expectedStartTime: decision.startTime,
    expectedSurfaceRef: decision.surfaceRef,
    recheck,
    surface: surfaceRecheck,
  });
  if (!recheckDecision.ok) {
    process.stderr.write(
      `送信直前の再照合に失敗したため tell を中止しました (fail-closed)。\n`
    );
    reportDeny(sessionId, recheckDecision.reason, recheckDecision.detail);
    process.exit(1);
  }

  await cmuxSend(decision.surfaceRef, text);
  await cmuxSendKey(decision.surfaceRef, "Return");

  console.log(`送信完了: ${sessionId} (${decision.surfaceRef})`);
}

/** 拒否理由コードと補足を stderr に出す。代替手段の案内も付ける。 */
function reportDeny(
  sessionId: string,
  reason: DenyReason,
  detail?: string
): void {
  process.stderr.write(
    `tell を拒否しました: session ${sessionId} [${reason}]\n`
  );
  if (detail) process.stderr.write(`  ${detail}\n`);
  // busy / not_found 等は send (inbox 配送) が代替になる。
  if (reason !== "multiline") {
    process.stderr.write(
      `  代替: cmux-msg send <sid> "..." で inbox に永続配送できます。\n`
    );
  }
}
