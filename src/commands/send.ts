import { requireSessionId } from "../config";
import { sendMessage } from "../lib/sender";
import { validateSessionId } from "../lib/validate";
import { readMetaBySid, warnIfCrossHome } from "../lib/meta";
import { UsageError } from "../lib/errors";
import { looksLikeFlag } from "../lib/argv";

const USAGE = `使い方:
  cmux-msg send <session_id>                  # 本文 stdin
  cmux-msg send <session_id> --text "<msg>"   # 一言オプション
  cmux-msg send <session_id> < msg.md         # ファイル経由
  cat msg.md | cmux-msg send <session_id>     # pipe 経由

本文を positional 引数で受けることはしない (DR-0014)。
stdin が TTY かつ --text 未指定なら usage error。

返信は reply を使う:
  cmux-msg reply <filename>                   # 本文 stdin
  cmux-msg reply <filename> --text "<msg>"`;

export interface ParsedSendArgs {
  target: string;
  text?: string;
}

export function parseSendArgs(args: string[]): ParsedSendArgs {
  const positional: string[] = [];
  let text: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--text") {
      const v = args[i + 1];
      if (v === undefined) {
        throw new UsageError("--text には値が必要です\n" + USAGE);
      }
      text = v;
      i++;
    } else if (a.startsWith("--text=")) {
      text = a.slice("--text=".length);
    } else if (looksLikeFlag(a)) {
      throw new UsageError(`不明なオプション: ${a}\n` + USAGE);
    } else {
      positional.push(a);
    }
  }

  const target = positional[0];
  if (!target) {
    throw new UsageError(USAGE);
  }
  if (positional.length > 1) {
    throw new UsageError(
      "本文を positional 引数で受けることはできません。--text または stdin を使ってください\n" + USAGE
    );
  }
  return { target, text };
}

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

export async function resolveSendBody(parsed: ParsedSendArgs): Promise<string> {
  if (parsed.text !== undefined) {
    return parsed.text;
  }
  if (process.stdin.isTTY) {
    throw new UsageError(
      "stdin が TTY で --text も指定されていません。\n" + USAGE
    );
  }
  return await readStdin();
}

export async function cmdSend(args: string[]): Promise<void> {
  requireSessionId();

  const parsed = parseSendArgs(args);
  validateSessionId(parsed.target);

  const body = await resolveSendBody(parsed);
  if (body.length === 0) {
    throw new UsageError("メッセージ本文が空です\n" + USAGE);
  }

  // DR-0005: peer が別 claude_home なら warning (block しない)
  warnIfCrossHome(readMetaBySid(parsed.target));

  const filename = await sendMessage({ target: parsed.target, body });
  console.log(`送信完了: ${filename} → ${parsed.target}`);
}
