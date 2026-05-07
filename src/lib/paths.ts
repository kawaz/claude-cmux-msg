/**
 * 純粋なパス計算と env 由来のベースパス解決。
 *
 * `config.ts` と `session-index.ts` の循環依存を断つために独立させた:
 *   - config.ts は env 解決 (getSessionId 等) を持ち、session-index.ts を呼ぶ
 *   - session-index.ts は paths.ts だけに依存
 *   - 三角形の依存にならない
 *
 * 旧版の `MSG_BASE` 定数 (import 時固定) は廃止。テスト時の env 切替が
 * すべての利用箇所に正しく反映されるよう、関数経由 (`getMsgBase()`) に統一。
 */

import * as path from "path";
import * as os from "os";

/**
 * メッセージ保管庫のベースパス。
 * env `CMUXMSG_BASE` を毎回評価する (テスト用に env 切替が効く)。
 */
export function getMsgBase(): string {
  return (
    process.env.CMUXMSG_BASE ||
    path.join(os.homedir(), ".local/share/cmux-messages")
  );
}
