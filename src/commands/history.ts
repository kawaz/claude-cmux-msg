import { requireCmux, getSessionId } from "../config";
import { listAllMessages, MessageRecord } from "../lib/history";

interface HistoryOpts {
  peer?: string;
  limit?: number;
}

function parseArgs(args: string[]): HistoryOpts {
  const opts: HistoryOpts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--peer" && i + 1 < args.length) {
      opts.peer = args[++i];
    } else if (a === "--limit" && i + 1 < args.length) {
      opts.limit = parseInt(args[++i] ?? "", 10);
    }
  }
  return opts;
}

function summary(body: string, max = 60): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function shortId(id: string): string {
  // UUID なら先頭8文字、そうでなければそのまま
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return id.slice(0, 8);
  return id;
}

function formatLine(rec: MessageRecord): string {
  const time = rec.created_at || "????-??-??T??:??:??";
  const arrow = rec.direction === "out" ? "→" : "←";
  const peer = rec.direction === "out" ? rec.to : rec.from;
  const peerShort = shortId(peer);
  const flag = rec.priority === "urgent" ? "⚡" : " ";
  const type = `[${rec.type}]`.padEnd(11);
  return `${time} ${arrow} ${peerShort} ${flag}${type} ${summary(rec.body)}  (${rec.dir}/${rec.filename})`;
}

export function cmdHistory(args: string[]): void {
  requireCmux();
  const opts = parseArgs(args);
  const self = getSessionId();

  let records = listAllMessages(self);

  if (opts.peer) {
    const peer = opts.peer;
    records = records.filter((r) => r.from === peer || r.to === peer);
  }

  if (records.length === 0) {
    console.log("(履歴なし)");
    return;
  }

  // 後ろから limit 件にトリム（最新から見たい）
  if (opts.limit && opts.limit > 0 && records.length > opts.limit) {
    records = records.slice(-opts.limit);
  }

  for (const rec of records) {
    console.log(formatLine(rec));
  }
}
