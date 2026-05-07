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
 * 冪等性 (#24 対策):
 *   accepted/<filename> に既に `response_at` が書かれていれば、前回の reply で
 *   送信は完了し archive 移動だけ失敗した状態。**二重送信を避け、archive 移動
 *   だけ完了させる**。前回の sentFilename は復元できないので空文字を返し、
 *   呼び出し側 (cmd reply) には警告として stderr に出す。
 *
 *   accepted/ にあって response_at が無ければ「未送信」とみなし、通常の送信を
 *   行う (これは旧実装と同じ挙動)。送信途中で失敗した場合の二重送信リスクは、
 *   sendMessage の cmuxSignal 失敗を握りつぶす設計上、極めて低い。
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

  // 冪等チェック: 前回の reply で response_at が書かれていれば既に送信済み。
  // 二重送信せず、accepted → archive の移動だけ完了させる。
  if (meta.response_at) {
    const archivePath = path.join(dir, "archive", filename);
    transitionMessage(filename, "accepted", "archive", {
      archive_at: meta.archive_at || nowIso(),
    });
    process.stderr.write(
      `[warning] ${filename} は既に reply 済み (response_at=${meta.response_at})。` +
        `再送は行わず、accepted/ → archive/ への移動だけ完了させました。\n`
    );
    return "";
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
