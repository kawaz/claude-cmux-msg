import { requireSessionId } from "../config";
import { listInbox, isNotify, type InboxMessage } from "../lib/inbox";

/**
 * notify (type=notify) は subscribe stream に本文同梱で即時 emit 済み (DR-0017)。
 * list に出続けると「読んだはずの通知」が context の無駄として残り続けるので除外する。
 * history / read では引き続き参照可能 (DR-0018 の方針に沿う、list 固有の表示ポリシー)。
 */
export function filterListable(messages: InboxMessage[]): InboxMessage[] {
  return messages.filter((m) => !isNotify(m));
}

export function cmdList(): void {
  requireSessionId();

  const messages = filterListable(listInbox());
  if (messages.length === 0) {
    console.log("(inbox は空です)");
    return;
  }

  for (const msg of messages) {
    const flag = msg.priority === "urgent" ? " ⚡" : "";
    console.log(`${msg.filename}  from:${msg.from}${flag}`);
  }
}
