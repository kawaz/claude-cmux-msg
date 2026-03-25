import { requireCmux, getSurfaceId } from "../config";
import { countInbox } from "../lib/message";
import { cmuxWaitFor } from "../lib/cmux";

export async function cmdWatch(args: string[]): Promise<void> {
  requireCmux();

  const mySurface = getSurfaceId();
  const timeout = parseInt(args[0] || "60", 10);

  // まず既存の未読を確認
  let count = countInbox();
  if (count > 0) {
    console.log(
      `inbox に ${count} 件の未読メッセージがあります。cmux-msg list で確認してください。`
    );
    return;
  }

  // 未読がなければ wait-for でシグナルを待つ
  const received = await cmuxWaitFor(`cmux-msg:${mySurface}`, timeout);
  if (received) {
    count = countInbox();
    if (count > 0) {
      console.log(
        `inbox に ${count} 件の未読メッセージがあります。cmux-msg list で確認してください。`
      );
    }
  }
  if (!received) {
    console.log(`${timeout}秒間メッセージはありませんでした。`);
  }
}
