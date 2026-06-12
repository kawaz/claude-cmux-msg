/**
 * 本文 (内容) を positional で受けるコマンド向けの引数ヘルパ。
 *
 * LLM エージェントは存在しないフラグ (`--type` / `--in-reply-to` / `-m` 等) を
 * 推測しがちで、それを本文に silent に混入させるとメタデータが失われ事故になる。
 * `-` で始まる未知引数は弾き、本文が正当に `-` で始まるケースは `--` セパレータで
 * 救う。
 */

/** `-` で始まる引数か (空文字 `-` 単体は stdin 慣習で正当なので除外)。 */
export function looksLikeFlag(arg: string): boolean {
  return arg.startsWith("-") && arg !== "-";
}

/**
 * `--` セパレータで args を二分する。
 *
 * - セパレータが無ければ `{ before: args, after: undefined }`
 * - 最初の `--` より前を `before`、後ろを `after` (配列、空配列もありうる)
 * - 2 個目以降の `--` は解釈せず `after` 側にそのまま残る
 */
export function splitDoubleDash(args: string[]): {
  before: string[];
  after: string[] | undefined;
} {
  const idx = args.indexOf("--");
  if (idx === -1) return { before: args, after: undefined };
  return { before: args.slice(0, idx), after: args.slice(idx + 1) };
}
