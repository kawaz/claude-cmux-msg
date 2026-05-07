import { requireCmux, getSessionId } from "../config";
import { listAllMessages, MessageRecord } from "../lib/history";
import { shortId, TYPE_LABEL_WIDTH } from "../lib/format";
import { validateSessionId } from "../lib/validate";

interface HistoryOpts {
  peer?: string;
  limit?: number;
  json?: boolean;
}

function parseArgs(args: string[]): HistoryOpts {
  const opts: HistoryOpts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--peer" && i + 1 < args.length) {
      opts.peer = args[++i];
    } else if (a === "--limit" && i + 1 < args.length) {
      opts.limit = parseInt(args[++i] ?? "", 10);
    } else if (a === "--json") {
      opts.json = true;
    }
  }
  return opts;
}

function summary(body: string, max = 60): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function formatLine(rec: MessageRecord): string {
  const time = rec.created_at || "????-??-??T??:??:??";
  const arrow = rec.direction === "out" ? "→" : "←";
  const peer = rec.direction === "out" ? rec.to : rec.from;
  const peerShort = shortId(peer);
  const flag = rec.priority === "urgent" ? "⚡" : " ";
  const type = `[${rec.type}]`.padEnd(TYPE_LABEL_WIDTH);
  return `${time} ${arrow} ${peerShort} ${flag}${type} ${summary(rec.body)}  (${rec.dir}/${rec.filename})`;
}

export function cmdHistory(args: string[]): void {
  requireCmux();
  const opts = parseArgs(args);
  const self = getSessionId();

  let records = listAllMessages(self);

  if (opts.peer) {
    validateSessionId(opts.peer);
    const peer = opts.peer;
    records = records.filter((r) => r.from === peer || r.to === peer);
  }

  if (records.length === 0) {
    if (opts.json) return;
    console.log("(履歴なし)");
    return;
  }

  // 後ろから limit 件にトリム（最新から見たい）
  if (opts.limit && opts.limit > 0 && records.length > opts.limit) {
    records = records.slice(-opts.limit);
  }

  if (opts.json) {
    // JSONL: 1 行 = 1 メッセージ
    for (const rec of records) {
      process.stdout.write(JSON.stringify(rec) + "\n");
    }
    return;
  }

  for (const rec of records) {
    console.log(formatLine(rec));
  }
}
