import { requireSessionId } from "../config";
import { replyMessage } from "../lib/transition";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";
import { looksLikeFlag } from "../lib/argv";

const USAGE = `使い方:
  cmux-msg reply <filename>                   # 本文 stdin
  cmux-msg reply <filename> --text "<msg>"    # 一言オプション
  cmux-msg reply <filename> < reply.md        # ファイル経由

本文を positional 引数で受けることはしない (DR-0014)。
stdin が TTY かつ --text 未指定なら usage error。`;

export interface ParsedReplyArgs {
  filename: string;
  text?: string;
}

export function parseReplyArgs(args: string[]): ParsedReplyArgs {
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

  const filename = positional[0];
  if (!filename) {
    throw new UsageError(USAGE);
  }
  if (positional.length > 1) {
    throw new UsageError(
      "本文を positional 引数で受けることはできません。--text または stdin を使ってください\n" + USAGE
    );
  }
  return { filename, text };
}

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

async function resolveReplyBody(parsed: ParsedReplyArgs): Promise<string> {
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

export async function cmdReply(args: string[]): Promise<void> {
  requireSessionId();

  const parsed = parseReplyArgs(args);
  validateFilename(parsed.filename);

  const body = await resolveReplyBody(parsed);
  if (body.length === 0) {
    throw new UsageError("返信本文が空です\n" + USAGE);
  }

  await replyMessage(parsed.filename, body);
  console.log("返信送信 & アーカイブ完了");
}
