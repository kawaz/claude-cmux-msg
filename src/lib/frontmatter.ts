/**
 * frontmatter パーサー / シリアライザ
 * 外部ライブラリに依存しない自前実装
 */

export interface ParsedMessage {
  meta: Record<string, string>;
  body: string;
}

/**
 * frontmatter 付きテキストをパースする
 * ---
 * key: value
 * ---
 * body...
 */
export function parseFrontmatter(
  content: string
): ParsedMessage {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    return { meta: {}, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { meta: {}, body: content };
  }

  const meta: Record<string, string> = {};
  for (let i = 1; i < endIndex; i++) {
    const line = lines[i] ?? "";
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) {
      meta[key] = value;
    }
  }

  // body は frontmatter 終了の次の行から（先頭の空行1つは除去）
  let bodyStart = endIndex + 1;
  if (lines[bodyStart] === "") {
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join("\n");

  return { meta, body };
}

/**
 * frontmatter 付きテキストを生成する
 */
export function serializeFrontmatter(
  meta: Record<string, string | undefined>,
  body: string
): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

/**
 * frontmatter にフィールドを挿入する（既存テキストを直接操作）
 */
export function insertFrontmatterField(
  content: string,
  fields: Record<string, string>
): string {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    return content;
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return content;
  }

  // 既存キーがあれば値を更新、なければ終了 --- の直前に追加
  for (const [key, value] of Object.entries(fields)) {
    let found = false;
    for (let i = 1; i < endIndex; i++) {
      const line = lines[i] ?? "";
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const existingKey = line.slice(0, colonIdx).trim();
      if (existingKey === key) {
        lines[i] = `${key}: ${value}`;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.splice(endIndex, 0, `${key}: ${value}`);
      endIndex++; // 挿入した分だけ endIndex をずらす
    }
  }

  return lines.join("\n");
}
