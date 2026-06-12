import { requireSessionId, getSessionId } from "../config";
import {
  listAllMessages,
  computeThreadRoots,
  MessageRecord,
} from "../lib/history";
import { shortId, messageShortId, TYPE_LABEL_WIDTH } from "../lib/format";
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

function formatLine(rec: MessageRecord, threadRootFilename: string): string {
  const time = rec.created_at || "????-??-??T??:??:??";
  const tid = `[${messageShortId(threadRootFilename)}]`;
  const arrow = rec.direction === "out" ? "→" : "←";
  const peer = rec.direction === "out" ? rec.to : rec.from;
  const peerShort = shortId(peer);
  const flag = rec.priority === "urgent" ? "⚡" : " ";
  const type = `[${rec.type}]`.padEnd(TYPE_LABEL_WIDTH);
  return `${time} ${tid} ${arrow} ${peerShort} ${flag}${type} ${summary(rec.body)}  (${rec.dir}/${rec.filename})`;
}

export function cmdHistory(args: string[]): void {
  requireSessionId();
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

  // thread root は trim/limit する前の全件で計算する。
  // (limit で trim 後に計算すると、表示行外の親が「records に無い」判定で
  //  reply が自分を root とみなしてしまい thread_id が分断される)
  const roots = computeThreadRoots(records);

  // 後ろから limit 件にトリム（最新から見たい）
  if (opts.limit && opts.limit > 0 && records.length > opts.limit) {
    records = records.slice(-opts.limit);
  }

  if (opts.json) {
    // JSONL: 1 行 = 1 メッセージ (thread_root_filename を追加)
    for (const rec of records) {
      const root = roots.get(rec.filename) ?? rec.filename;
      process.stdout.write(
        JSON.stringify({
          ...rec,
          thread_root_filename: root,
          thread_short_id: messageShortId(root),
        }) + "\n"
      );
    }
    return;
  }

  for (const rec of records) {
    const root = roots.get(rec.filename) ?? rec.filename;
    console.log(formatLine(rec, root));
  }
}
