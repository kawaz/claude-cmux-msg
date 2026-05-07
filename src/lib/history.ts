/**
 * 自分のセッションディレクトリ内の全メッセージを集約・列挙する。
 * inbox/, accepted/, archive/, sent/ を横断し、from/to/created_at/type 等を
 * メタ情報として返す。`history` / `thread` サブコマンドの土台。
 */

import * as fs from "fs";
import * as path from "path";
import { myDir } from "../config";
import { parseFrontmatter } from "./frontmatter";

export type MessageDirection = "in" | "out";

export interface MessageRecord {
  filename: string;
  dir: "inbox" | "accepted" | "archive" | "sent";
  direction: MessageDirection;
  from: string;
  to: string;
  type: string;
  priority: string;
  created_at: string;
  in_reply_to: string | null;
  /** 同じ broadcast から派生した N 件のメッセージは同じ ID を持つ */
  broadcast_id: string | null;
  body: string;
}

const SUBDIRS = ["inbox", "accepted", "archive", "sent"] as const;
type SubDir = (typeof SUBDIRS)[number];

function readMessageFile(
  baseDir: string,
  sub: SubDir,
  filename: string,
  selfSessionId: string
): MessageRecord | null {
  const filepath = path.join(baseDir, sub, filename);
  let content: string;
  try {
    content = fs.readFileSync(filepath, "utf-8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(content);
  const from = meta.from || "";
  const to = meta.to || "";
  // sent/ にあるなら自分が送信側 (out)、それ以外 (inbox/accepted/archive) なら受信側 (in)
  // 古いメッセージで sent/ がない時代のものは from で判定する
  const direction: MessageDirection =
    sub === "sent" ? "out" : from === selfSessionId ? "out" : "in";

  return {
    filename,
    dir: sub,
    direction,
    from,
    to,
    type: meta.type || "request",
    priority: meta.priority || "normal",
    created_at: meta.created_at || "",
    in_reply_to: meta.in_reply_to || null,
    broadcast_id: meta.broadcast_id || null,
    body,
  };
}

/**
 * 自分の全 sub-directory のメッセージを列挙し、created_at の昇順で返す。
 * 同じ filename が複数 sub-directory に出ることはない（sent は送信、他は受信）。
 */
export function listAllMessages(selfSessionId: string): MessageRecord[] {
  const dir = myDir();
  const records: MessageRecord[] = [];

  for (const sub of SUBDIRS) {
    const subDir = path.join(dir, sub);
    if (!fs.existsSync(subDir)) continue;
    let files: string[];
    try {
      files = fs.readdirSync(subDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const filename of files) {
      const rec = readMessageFile(dir, sub, filename, selfSessionId);
      if (rec) records.push(rec);
    }
  }

  records.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return records;
}

/**
 * thread (in_reply_to の連鎖) を構築する。
 *
 * 自分のディレクトリ内で完結する範囲で:
 *   - 親方向: in_reply_to を遡り、対応する filename を見つけたら追加
 *   - 子方向: in_reply_to == 自分の filename のメッセージを追加 (再帰)
 *
 * 注: 「相手が私の reply に対してさらに reply した」のような会話は、相手側の
 * 送信元データと自分側の受信データに分かれて両側に存在する。自分の sent と
 * inbox/accepted/archive を見れば、自分が関与した分は完全に追える。
 */
export function buildThread(
  startFilename: string,
  selfSessionId: string
): MessageRecord[] {
  const all = listAllMessages(selfSessionId);
  const byFilename = new Map<string, MessageRecord>();
  for (const rec of all) byFilename.set(rec.filename, rec);

  const start = byFilename.get(startFilename);
  if (!start) return [];

  const collected = new Set<string>();
  collected.add(start.filename);

  // 親方向 (遡る)
  let cursor: MessageRecord | undefined = start;
  while (cursor?.in_reply_to) {
    const parent = byFilename.get(cursor.in_reply_to);
    if (!parent || collected.has(parent.filename)) break;
    collected.add(parent.filename);
    cursor = parent;
  }

  // 子方向 (前方探索, BFS)
  const queue: string[] = [start.filename];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const rec of all) {
      if (rec.in_reply_to === current && !collected.has(rec.filename)) {
        collected.add(rec.filename);
        queue.push(rec.filename);
      }
    }
  }

  const thread = all.filter((r) => collected.has(r.filename));
  thread.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return thread;
}
