import { requireCmux } from "../config";
import { listInbox } from "../lib/message";

export function cmdList(): void {
  requireCmux();

  try {
    const messages = listInbox();
    if (messages.length === 0) {
      console.log("(inbox は空です)");
      return;
    }

    for (const msg of messages) {
      const flag = msg.priority === "urgent" ? " ⚡" : "";
      console.log(`${msg.filename}  from:${msg.from}${flag}`);
    }
  } catch (e) {
    console.error(`エラー: ${(e as Error).message}`);
    process.exit(1);
  }
}
