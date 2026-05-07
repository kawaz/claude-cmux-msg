/**
 * メッセージの状態遷移 (inbox → accepted / archive、reply など)。
 *
 * 責務:
 *   - accept: inbox → accepted (read_at 追記)
 *   - dismiss: inbox → archive (read_at + archive_at 追記)
 *   - reply: 元メッセージを accept してから返信を送信、自分側を archive へ
 *
 * 共通遷移ロジック (transitionMessage) で 3 関数のロジック重複を解消。
 */

import * as fs from "fs";
import * as path from "path";
import { nowIso, myDir } from "../config";
import {
  parseFrontmatter,
  insertFrontmatterField,
} from "./frontmatter";
import { sendMessage } from "./sender";

type SubDir = "inbox" | "accepted" | "archive" | "sent";

/**
 * 自分の `<from>/<filename>` を `<to>/<filename>` に rename しつつ
 * frontmatter にフィールドを追記する。共通の遷移処理。
 */
function transitionMessage(
  filename: string,
  from: SubDir,
  to: SubDir,
  fields: Record<string, string>
): void {
  const dir = myDir();
  const src = path.join(dir, from, filename);
  const dst = path.join(dir, to, filename);

  if (!fs.existsSync(src)) {
    throw new Error(`${filename} が ${from}/ に見つかりません`);
  }

  let content = fs.readFileSync(src, "utf-8");
  content = insertFrontmatterField(content, fields);
  fs.writeFileSync(src, content);
  fs.renameSync(src, dst);
}

/** メッセージを accept (inbox → accepted)、read_at を追記 */
export function acceptMessage(filename: string): void {
  transitionMessage(filename, "inbox", "accepted", { read_at: nowIso() });
}

/** メッセージを dismiss (inbox → archive)、read_at + archive_at を追記 */
export function dismissMessage(filename: string): void {
  const now = nowIso();
  transitionMessage(filename, "inbox", "archive", {
    read_at: now,
    archive_at: now,
  });
}

/**
 * reply: 元メッセージを accept してから返信を送信、自分側を archive へ。
 *
 * 失敗パターン (#24):
 *   - send 部分失敗時: accepted/ に半端な状態で残るが、再 reply で復旧可能
 *     (二重送信リスクは極めて低い、cmuxSignal 失敗を握りつぶすため)
 *   - send 後の archive 失敗時: 送信は成功、accepted/ に response_at が
 *     追記されないが、ファイル自体は accepted/ に残るので致命的ではない
 */
export async function replyMessage(
  filename: string,
  body: string
): Promise<string> {
  const dir = myDir();
  const inboxPath = path.join(dir, "inbox", filename);
  const acceptedPath = path.join(dir, "accepted", filename);

  // inbox or accepted どちらにあっても対応
  let src: string;
  if (fs.existsSync(inboxPath)) {
    acceptMessage(filename);
    src = acceptedPath;
  } else if (fs.existsSync(acceptedPath)) {
    src = acceptedPath;
  } else {
    throw new Error(`${filename} が inbox にも accepted にも見つかりません`);
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
  transitionMessage(filename, "accepted", "archive", {
    response_at: now,
    archive_at: now,
  });

  return sentFilename;
}
