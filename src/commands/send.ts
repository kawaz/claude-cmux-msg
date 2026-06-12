import * as fs from "fs";
import { requireSessionId } from "../config";
import { sendMessage } from "../lib/sender";
import { validateSessionId } from "../lib/validate";
import { readMetaBySid, warnIfCrossHome } from "../lib/meta";
import { UsageError } from "../lib/errors";
import { looksLikeFlag, splitDoubleDash } from "../lib/argv";

const USAGE = `使い方: cmux-msg send <session_id> [<メッセージ>]
       cmux-msg send <session_id> --file <path>
       cmux-msg send <session_id> --file -    # stdin から読み込み
       cmux-msg send <session_id> -- <メッセージ>  # 本文が - で始まる場合
       cat msg.md | cmux-msg send <session_id>  # メッセージ省略時は stdin (非 TTY のみ)

返信は send ではなく reply を使う:
       cmux-msg reply <filename> <返信内容>
(send に --in-reply-to / --type 等の返信フラグは無い。reply が in_reply_to を付与する)`;

export interface ParsedSendArgs {
  target: string;
  body?: string;
  file?: string;
}

export function parseSendArgs(args: string[]): ParsedSendArgs {
  // `--` 以降は全て本文 (positional)。本文が `-` で始まる正当ケースの逃げ道。
  const { before, after } = splitDoubleDash(args);

  const positional: string[] = [];
  let file: string | undefined;

  for (let i = 0; i < before.length; i++) {
    const a = before[i]!;
    if (a === "--file") {
      const v = before[i + 1];
      if (v === undefined) {
        throw new UsageError("--file には値が必要です\n" + USAGE);
      }
      file = v;
      i++;
    } else if (a.startsWith("--file=")) {
      file = a.slice("--file=".length);
    } else if (looksLikeFlag(a)) {
      // 未知の `-`/`--` 始まり引数は本文に silent 混入させず弾く。
      // 本文が正当に `-` で始まるなら `send <id> -- <本文>` を使う。
      throw new UsageError(`不明なオプション: ${a}\n` + USAGE);
    } else {
      positional.push(a);
    }
  }

  const target = positional[0];
  if (!target) {
    throw new UsageError(USAGE);
  }

  // `--` 以降のトークンも本文を構成する (positional の続きとして連結)。
  const bodyParts = positional.slice(1);
  if (after !== undefined) bodyParts.push(...after);

  // body は --file が無ければ positional の残りを join。
  // --file 指定時に message が同時指定されたらエラー (曖昧さ回避)。
  if (file !== undefined && bodyParts.length >= 1) {
    throw new UsageError(
      "--file と <メッセージ> は同時に指定できません\n" + USAGE
    );
  }

  const body = bodyParts.length >= 1 ? bodyParts.join(" ") : undefined;
  return { target, body, file };
}

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

export async function resolveSendBody(parsed: ParsedSendArgs): Promise<string> {
  if (parsed.file !== undefined) {
    if (parsed.file === "-") {
      return await readStdin();
    }
    return fs.readFileSync(parsed.file, "utf-8");
  }
  if (parsed.body !== undefined) {
    return parsed.body;
  }
  // 引数省略時は stdin から読み込み (対話的入力との誤動作を防ぐため非 TTY 必須)
  if (process.stdin.isTTY) {
    throw new UsageError(USAGE);
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
