import { requireCmux } from "../config";
import { listInbox } from "../lib/message";

export function cmdList(): void {
  requireCmux();

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
