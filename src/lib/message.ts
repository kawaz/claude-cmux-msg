/**
 * メッセージ読み書きユーティリティ
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { timestamp, nowIso, getSessionId, peerDir, myDir } from "../config";
import {
  parseFrontmatter,
  serializeFrontmatter,
  insertFrontmatterField,
} from "./frontmatter";
import { cmuxSignal } from "./cmux";
import { validateSessionId } from "./validate";

export interface SendOptions {
  target: string;
  body: string;
  type?: "request" | "response" | "broadcast";
  priority?: "normal" | "urgent";
  inReplyTo?: string;
}

/**
 * メッセージを送信する
 */
export async function sendMessage(opts: SendOptions): Promise<string> {
  validateSessionId(opts.target);

  const targetDir = peerDir(opts.target);
  const inboxDir = path.join(targetDir, "inbox");

  if (!fs.existsSync(inboxDir)) {
    throw new Error(`宛先 ${opts.target} が見つかりません`);
  }

  const ts = timestamp();
  const filename = `${ts}-${randomUUID().slice(0, 8)}.md`;
  const tmpFile = path.join(targetDir, "tmp", filename);
  const inboxFile = path.join(inboxDir, filename);

  const meta: Record<string, string | undefined> = {
    from: getSessionId(),
    to: opts.target,
    type: opts.type || process.env.CMUXMSG_TYPE || "request",
    priority:
      opts.priority ||
      (process.env.CMUXMSG_PRIORITY as "normal" | "urgent") ||
      "normal",
    created_at: nowIso(),
    in_reply_to: opts.inReplyTo || process.env.CMUXMSG_REPLY_TO || undefined,
  };

  const content = serializeFrontmatter(meta, opts.body);

  // tmp に書いてから mv で原子的に配送
  fs.writeFileSync(tmpFile, content);
  fs.renameSync(tmpFile, inboxFile);

  // 送信側の sent/ にもエントリを残す
  // 「自分が誰に何を送ったか」を後で辿れるようにするため。
  // hardlink で配送先 (相手 inbox/) と同じ inode を共有する:
  //   - メッセージ実体は1つ
  //   - 受信側で frontmatter (read_at / response_at / archive_at) が追記されると
  //     送信側からも相手の処理状況が見える
  //   - 受信側が rename (inbox→accepted/archive) しても inode 不変なので影響なし
  // hardlink 不可な FS (クロスデバイス等) では copy にフォールバック。
  // 同期失敗しても送信自体は成功扱いとする。
  try {
    const sentDir = path.join(myDir(), "sent");
    fs.mkdirSync(sentDir, { recursive: true });
    const sentFile = path.join(sentDir, filename);
    try {
      fs.linkSync(inboxFile, sentFile);
    } catch {
      try { fs.writeFileSync(sentFile, content); } catch {}
    }
  } catch {
    // sent/ への記録失敗は致命的ではない
  }

  // wait-for シグナルで受信側に通知（UUID ベース）
  try {
    await cmuxSignal(`cmux-msg:${opts.target}`);
  } catch {
    // cmux が無くても送信自体は成功
  }

  return filename;
}

export interface InboxMessage {
  filename: string;
  from: string;
  priority: string;
  type: string;
  created_at: string;
  in_reply_to: string | null;
}

/**
 * inbox のメッセージ一覧を取得する
 */
export function listInbox(): InboxMessage[] {
  const dir = myDir();
  const inboxDir = path.join(dir, "inbox");

  if (!fs.existsSync(inboxDir)) {
    throw new Error(
      "inboxが未初期化です。cmux-msg init を実行してください。"
    );
  }

  const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md")).sort();
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
    });
  }

  return result;
}

/**
 * メッセージファイルを読む
 */
export function readMessage(filename: string): string {
  const dir = myDir();
  const filepath = path.join(dir, "inbox", filename);

  if (!fs.existsSync(filepath)) {
    throw new Error(`${filename} が inbox に見つかりません`);
  }

  return fs.readFileSync(filepath, "utf-8");
}

/**
 * メッセージを accept (inbox → accepted)
 */
export function acceptMessage(filename: string): void {
  const dir = myDir();
  const src = path.join(dir, "inbox", filename);
  const dst = path.join(dir, "accepted", filename);

  if (!fs.existsSync(src)) {
    throw new Error(`${filename} が inbox に見つかりません`);
  }

  let content = fs.readFileSync(src, "utf-8");
  content = insertFrontmatterField(content, { read_at: nowIso() });
  fs.writeFileSync(src, content);
  fs.renameSync(src, dst);
}

/**
 * メッセージを dismiss (inbox → archive)
 */
export function dismissMessage(filename: string): void {
  const dir = myDir();
  const src = path.join(dir, "inbox", filename);
  const dst = path.join(dir, "archive", filename);

  if (!fs.existsSync(src)) {
    throw new Error(`${filename} が inbox に見つかりません`);
  }

  const now = nowIso();
  let content = fs.readFileSync(src, "utf-8");
  content = insertFrontmatterField(content, {
    read_at: now,
    archive_at: now,
  });
  fs.writeFileSync(src, content);
  fs.renameSync(src, dst);
}

/**
 * reply: 返信送信 & アーカイブ
 */
export async function replyMessage(
  filename: string,
  body: string
): Promise<string> {
  const dir = myDir();
  let src: string;

  // inbox or accepted どちらにあっても対応
  const inboxPath = path.join(dir, "inbox", filename);
  const acceptedPath = path.join(dir, "accepted", filename);

  if (fs.existsSync(inboxPath)) {
    // inbox にあるなら先に accept する
    acceptMessage(filename);
    src = acceptedPath;
  } else if (fs.existsSync(acceptedPath)) {
    src = acceptedPath;
  } else {
    throw new Error(
      `${filename} が inbox にも accepted にも見つかりません`
    );
  }

  // 元メッセージの from を取得
  const content = fs.readFileSync(src, "utf-8");
  const { meta } = parseFrontmatter(content);
  const originalFrom = meta.from;

  if (!originalFrom) {
    throw new Error("元メッセージのfromが不明です");
  }

  // 返信送信
  const sentFilename = await sendMessage({
    target: originalFrom,
    body,
    type: "response",
    inReplyTo: filename,
  });

  // accepted → archive に移動
  const now = nowIso();
  let updated = fs.readFileSync(src, "utf-8");
  updated = insertFrontmatterField(updated, {
    response_at: now,
    archive_at: now,
  });
  fs.writeFileSync(src, updated);
  const archivePath = path.join(dir, "archive", filename);
  fs.renameSync(src, archivePath);

  return sentFilename;
}

/**
 * inbox のメッセージ数を数える
 */
export function countInbox(): number {
  const dir = myDir();
  const inboxDir = path.join(dir, "inbox");

  if (!fs.existsSync(inboxDir)) {
    return 0;
  }

  return fs.readdirSync(inboxDir).filter((f) => f.endsWith(".md")).length;
}
