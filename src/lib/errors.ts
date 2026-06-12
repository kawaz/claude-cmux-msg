/**
 * 引数不足や使い方違反など、ユーザに usage を見せたいエラー。
 * cli.ts のトップレベル catch で「エラー:」プレフィックスなしで表示する。
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * 実行前提が満たされないエラー (session_id 解決不能 / cmux 環境外など)。
 * message に既に「エラー:」プレフィックスを含むため、cli.ts は追加せずそのまま表示する。
 */
export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}
