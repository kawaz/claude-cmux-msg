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
  const result = await cmuxWaitFor(`cmux-msg:${mySurface}`, timeout);
  const elapsedSec = (result.elapsedMs / 1000).toFixed(2);

  if (result.kind === "received") {
    count = countInbox();
    if (count > 0) {
      console.log(
        `inbox に ${count} 件の未読メッセージがあります。cmux-msg list で確認してください。`
      );
    } else {
      console.log(
        `シグナルを受信しましたが未読メッセージはありませんでした。(${elapsedSec}s)`
      );
    }
    return;
  }

  if (result.kind === "timeout") {
    console.log(`${timeout}秒間メッセージはありませんでした。(実測 ${elapsedSec}s)`);
    return;
  }

  // result.kind === "error"
  console.error(
    `cmux wait-for がエラー終了しました (exit=${result.exitCode}, ${elapsedSec}s):`
  );
  if (result.stderr) {
    console.error(result.stderr);
  }
  process.exit(1);
}
