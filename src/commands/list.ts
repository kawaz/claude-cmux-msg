import { requireSessionId } from "../config";
import { listInbox } from "../lib/inbox";

export function cmdList(): void {
  requireSessionId();

  const messages = listInbox();
  if (messages.length === 0) {
    console.log("(inbox は空です)");
    return;
  }

  for (const msg of messages) {
    const flag = msg.priority === "urgent" ? " ⚡" : "";
    console.log(`${msg.filename}  from:${msg.from}${flag}`);
  }
}
