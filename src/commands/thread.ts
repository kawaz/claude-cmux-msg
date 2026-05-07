import { requireCmux, getSessionId } from "../config";
import { buildThread, MessageRecord } from "../lib/history";
import { validateFilename } from "../lib/validate";
import { shortId } from "../lib/format";
import { UsageError } from "../lib/errors";

function header(rec: MessageRecord): string {
  const arrow = rec.direction === "out" ? "→" : "←";
  const peer = rec.direction === "out" ? rec.to : rec.from;
  const peerShort = shortId(peer);
  return `[${rec.created_at}] ${arrow} ${peerShort}  type=${rec.type}  (${rec.dir}/${rec.filename})`;
}

export function cmdThread(args: string[]): void {
  requireCmux();
  const json = args.includes("--json");
  const positional = args.filter((a) => a !== "--json");
  if (positional.length === 0) {
    throw new UsageError("使い方: cmux-msg thread <filename> [--json]");
  }
  const filename = positional[0]!;
  validateFilename(filename);

  const self = getSessionId();
  const thread = buildThread(filename, self);

  if (thread.length === 0) {
    if (json) {
      process.stdout.write("[]\n");
      return;
    }
    throw new Error(`${filename} が見つかりません (inbox/accepted/archive/sent)`);
  }

  if (json) {
    process.stdout.write(JSON.stringify(thread, null, 2) + "\n");
    return;
  }

  for (let i = 0; i < thread.length; i++) {
    const rec = thread[i]!;
    if (i > 0) console.log("");
    console.log(header(rec));
    console.log("─".repeat(60));
    console.log(rec.body);
  }
}
