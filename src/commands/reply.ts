import { requireSessionId } from "../config";
import { replyMessage } from "../lib/transition";
import { validateFilename } from "../lib/validate";
import { UsageError } from "../lib/errors";
import { looksLikeFlag, splitDoubleDash } from "../lib/argv";

const USAGE = `使い方: cmux-msg reply <filename> <返信内容>
       cmux-msg reply <filename> -- <返信内容>  # 本文が - で始まる場合`;

export interface ParsedReplyArgs {
  filename: string;
  body: string;
}

export function parseReplyArgs(args: string[]): ParsedReplyArgs {
  // `--` 以降は全て本文。本文が `-` で始まる正当ケースの逃げ道。
  const { before, after } = splitDoubleDash(args);

  const positional: string[] = [];
  for (const a of before) {
    if (looksLikeFlag(a)) {
      // 未知フラグを本文に silent 混入させず弾く (LLM の `-m` 等の推測対策)。
      throw new UsageError(`不明なオプション: ${a}\n` + USAGE);
    }
    positional.push(a);
  }

  const filename = positional[0];
  if (!filename) {
    throw new UsageError(USAGE);
  }

  const bodyParts = positional.slice(1);
  if (after !== undefined) bodyParts.push(...after);
  if (bodyParts.length === 0) {
    throw new UsageError(USAGE);
  }

  return { filename, body: bodyParts.join(" ") };
}

export async function cmdReply(args: string[]): Promise<void> {
  requireSessionId();

  const { filename, body } = parseReplyArgs(args);
  validateFilename(filename);

  await replyMessage(filename, body);
  console.log("返信送信 & アーカイブ完了");
}
