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
