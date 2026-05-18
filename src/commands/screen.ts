import { requireCmux } from "../config";
import { cmuxReadScreen } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { lookupSidProcess } from "../lib/session-proc";
import { resolveSurfaceByTty } from "../lib/cmux-surface";
import { evaluateScreenGuard, type DenyReason } from "../lib/tell-guard";

/**
 * DR-0007: screen の安全境界 (決定2/5)。
 *
 * `screen <sid>` は対象 claude の cmux surface 画面を読む。誤った surface の
 * 誤読を防ぐため、次を全て満たすときのみ読む:
 *
 *   - sid 照合がちょうど 1 件 (`lookupSidProcess`)
 *   - claude の tty → cmux surface 逆引きが成功 (`resolveSurfaceByTty`)
 *   - claude が foreground process group にいる (pgid==tpgid)
 *   - claude の runState が running (suspended / zombie / unresponsive は拒否)
 *
 * tell と違い `meta.state` は**問わない** (running 中の画面読み取りこそ有用、
 * DR-0007 決定5)。state を読まないので cross-home でも block しない。
 *
 * 引数なし (`screen` 単独) の場合は自分の surface を読むだけなので制約なし。
 */
export async function cmdScreen(args: string[]): Promise<void> {
  requireCmux();

  const sessionId = args[0];
  let ref: string | undefined;
  if (sessionId) {
    validateSessionId(sessionId);

    const proc = lookupSidProcess(sessionId);
    const surface =
      proc.kind === "found"
        ? await resolveSurfaceByTty(proc.tty)
        : ({ kind: "no_surface" } as const);

    const decision = evaluateScreenGuard({ proc, surface });
    if (!decision.allow) {
      reportDeny(sessionId, decision.reason, decision.detail);
      process.exit(1);
    }
    ref = decision.surfaceRef;
  }
  const content = await cmuxReadScreen(ref, true);
  console.log(content);
}

/** 拒否理由コードと補足を stderr に出す。 */
function reportDeny(
  sessionId: string,
  reason: DenyReason,
  detail?: string
): void {
  process.stderr.write(
    `screen を拒否しました: session ${sessionId} [${reason}]\n`
  );
  if (detail) process.stderr.write(`  ${detail}\n`);
}
