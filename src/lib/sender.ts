/**
 * メッセージ送信。
 *
 * 責務:
 *   - 相手 inbox にメッセージファイルを原子的に配送 (tmp + rename)
 *   - 自分 sent/ に hardlink で送信ログを残す
 *   - cmux signal で受信側に通知
 *
 * broadcast / reply / send は内部で sendMessage を呼ぶ。
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { timestamp, nowIso, getSessionId, peerDir, myDir } from "../config";
import { serializeFrontmatter } from "./frontmatter";
import { cmuxSignal } from "./cmux";
import { validateSessionId } from "./validate";

export interface SendOptions {
  target: string;
  body: string;
  type?: "request" | "response" | "broadcast";
  priority?: "normal" | "urgent";
  inReplyTo?: string;
}

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
  // クロス FS など hardlink 不可の場合は sent/ への記録を**諦める**:
  // copy で埋めると inode 共有という公開仕様 (README/SKILL) を裏切るため。
  // 一度だけ stderr に警告を出して、メッセージ送信自体は成功扱いで続行する。
  try {
    const sentDir = path.join(myDir(), "sent");
    fs.mkdirSync(sentDir, { recursive: true });
    const sentFile = path.join(sentDir, filename);
    try {
      fs.linkSync(inboxFile, sentFile);
    } catch (e) {
      process.stderr.write(
        `[warning] sent/ への hardlink 失敗 (${(e as Error).message || e})。` +
          `送信は成功、ただし sent/ には記録されません。` +
          `クロス FS 環境では CMUXMSG_BASE を peer と同じファイルシステムに置いてください。\n`
      );
    }
  } catch {
    // sent/ ディレクトリ作成失敗等は致命的ではない
  }

  // wait-for シグナルで受信側に通知（UUID ベース）
  try {
    await cmuxSignal(`cmux-msg:${opts.target}`);
  } catch {
    // cmux が無くても送信自体は成功
  }

  return filename;
}
