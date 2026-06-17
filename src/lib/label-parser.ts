/**
 * DR-0015 §3: label 文字制約 [a-zA-Z0-9_=]+、長さ上限 64。
 *
 * label add/remove はカンマ区切りで複数同時操作 (DR-0015 §5 + kawaz 確認)。
 * `,` は文字制約に含めていないため、コマンドの区切り文字として安全。
 */

export const LABEL_MAX_LENGTH = 64;
export const LABEL_PATTERN = /^[a-zA-Z0-9_=]+$/;

export class InvalidLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLabelError";
  }
}

export function validateLabel(label: string): void {
  if (label.length === 0) {
    throw new InvalidLabelError("label が空です");
  }
  if (label.length > LABEL_MAX_LENGTH) {
    throw new InvalidLabelError(
      `label は最大 ${LABEL_MAX_LENGTH} 文字: "${label}" (${label.length} 文字)`,
    );
  }
  if (!LABEL_PATTERN.test(label)) {
    throw new InvalidLabelError(
      `label に使えない文字が含まれます (許容: [a-zA-Z0-9_=]): "${label}"`,
    );
  }
}

/**
 * カンマ区切り文字列を label 配列に。
 * - 各要素を trim、空は捨てる
 * - 各要素を validateLabel
 * - 同一入力内の重複は除去 (= label add が ON CONFLICT IGNORE なので冪等だが、CLI 表示の混乱を防ぐ)
 */
export function parseLabels(input: string): string[] {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const p of parts) validateLabel(p);
  return Array.from(new Set(parts));
}
