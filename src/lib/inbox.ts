/**
 * 受信メッセージの読み出し。
 *
 * 責務:
 *   - 自分の inbox/ ディレクトリの一覧
 *   - メッセージファイルの内容取得
 *   - 件数カウント
 *
 * subscribe / list / read / count を支える。
 */

import * as fs from "fs";
import * as path from "path";
import { myDir } from "../config";
import { parseFrontmatter } from "./frontmatter";

export interface InboxMessage {
  filename: string;
  from: string;
  priority: string;
  type: string;
  created_at: string;
  in_reply_to: string | null;
  broadcast_id: string | null;
}

export function listInbox(): InboxMessage[] {
  const dir = myDir();
  const inboxDir = path.join(dir, "inbox");

  if (!fs.existsSync(inboxDir)) {
    throw new Error(
      "inboxが未初期化です。cmux-msg init を実行してください。"
    );
  }

  const files = fs
    .readdirSync(inboxDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const result: InboxMessage[] = [];

  for (const filename of files) {
    const filepath = path.join(inboxDir, filename);
    const content = fs.readFileSync(filepath, "utf-8");
    const { meta } = parseFrontmatter(content);
    result.push({
      filename,
      from: meta.from || "unknown",
      priority: meta.priority || "normal",
      type: meta.type || "request",
      created_at: meta.created_at || "",
      in_reply_to: meta.in_reply_to || null,
      broadcast_id: meta.broadcast_id || null,
    });
  }

  return result;
}

export function readMessage(filename: string): string {
  const dir = myDir();
  const filepath = path.join(dir, "inbox", filename);

  if (!fs.existsSync(filepath)) {
    throw new Error(`${filename} が inbox に見つかりません`);
  }

  return fs.readFileSync(filepath, "utf-8");
}

export function countInbox(): number {
  const dir = myDir();
  const inboxDir = path.join(dir, "inbox");

  if (!fs.existsSync(inboxDir)) {
    return 0;
  }

  return fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md")).length;
}
