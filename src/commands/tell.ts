import { requireCmux } from "../config";
import { cmuxSend, cmuxSendKey } from "../lib/cmux";
import { validateSessionId } from "../lib/validate";
import { resolvePeerSurfaceRef } from "../lib/peer-refs";
import { isProcessForeground } from "../lib/peer";
import { readMetaBySid } from "../lib/meta";

/**
 * DR-0004: tell の安全境界。
 *
 * - fg 必須: bg / suspended な session に tell すると、同 surface の別 sid に
 *   誤入力する事故が起きる
 * - state ∈ {idle, awaiting_permission} 必須: running 中に tell すると入力が
 *   吸い込まれて履歴に残らない、または別ターンに混ざる
 *
 * `--force` フラグは設けない (kawaz 指示: 「そこにいないとわかってる場所への
 * 読み書きは意味なし問題のみ」)。
 */
export async function cmdTell(args: string[]): Promise<void> {
  requireCmux();

  if (args.length < 2) {
    console.error("使い方: cmux-msg tell <session_id> <テキスト>");
    process.exit(1);
  }

  const sessionId = args[0]!;
  validateSessionId(sessionId);
  const text = args.slice(1).join(" ");

  const meta = readMetaBySid(sessionId);
  if (!meta) {
    console.error(`session ${sessionId} の meta.json が見つかりません`);
    process.exit(1);
  }

  // fg 判定 (ps -o stat= の `+` フラグ)
  if (!isProcessForeground(meta.shell_pid)) {
    console.error(
      `session ${sessionId} は foreground にないため tell を拒否しました ` +
        `(別 sid のプロセスに誤入力する事故を避けるため)。\n` +
        `  代替: cmux-msg send <sid> "..." で inbox に永続配送できます。`
    );
    process.exit(1);
  }

  // state 判定 (running 中は拒否)
  if (meta.state !== "idle" && meta.state !== "awaiting_permission") {
    console.error(
      `session ${sessionId} は state=${meta.state} のため tell を拒否しました ` +
        `(入力が吸い込まれて履歴に残らない可能性)。\n` +
        `  待機: state が idle / awaiting_permission に戻ってから再試行してください。\n` +
        `  代替: cmux-msg send <sid> "..." で inbox に永続配送できます。`
    );
    process.exit(1);
  }

  const ref = resolvePeerSurfaceRef(sessionId);
  await cmuxSend(ref, text);
  await cmuxSendKey(ref, "Return");

  console.log(`送信完了: ${sessionId}`);
}
