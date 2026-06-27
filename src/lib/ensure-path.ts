/**
 * SessionStart 用: PATH 上の cmux-msg の状態を判定し、適切な action を返す純粋関数群。
 *
 * 設計方針:
 *   - hook 自身の realpath から「いま起動した版の plugin root」を導出 (= 真の最新版)
 *   - PATH 上の cmux-msg の realpath と比較し、4 状態を出力
 *   - I/O (fs/which) は呼び出し側で行い、本 module は純粋判定のみ
 */

export type PathDecision =
  | { kind: "ok" }
  | { kind: "missing"; targetBin: string }
  | { kind: "outdated-symlink"; pathBin: string; targetBin: string }
  | { kind: "mismatched-non-symlink"; pathBin: string; targetBin: string };

export interface PathDecisionInput {
  /** hook 自身から導出した、最新の cmux-msg 実体パス (例: ${pluginRoot}/bin/cmux-msg)。realpath 解決済み。 */
  targetBin: string;
  /** PATH 上で見つかった cmux-msg のパス (which 結果)。なければ null。 */
  pathBin: string | null;
  /** pathBin の realpath 解決結果。なければ null。 */
  pathBinRealpath: string | null;
  /** pathBin が symlink かどうか (lstat 判定)。pathBin === null なら false。 */
  pathBinIsSymlink: boolean;
}

export function decidePathAction(input: PathDecisionInput): PathDecision {
  const { targetBin, pathBin, pathBinRealpath, pathBinIsSymlink } = input;
  if (pathBin === null) {
    return { kind: "missing", targetBin };
  }
  if (pathBinRealpath === targetBin) {
    return { kind: "ok" };
  }
  if (pathBinIsSymlink) {
    return { kind: "outdated-symlink", pathBin, targetBin };
  }
  return { kind: "mismatched-non-symlink", pathBin, targetBin };
}

/**
 * AI 向けメッセージを生成 (= SessionStart hook の stdout に流す)。
 * 各 case は会話に乗る前提で、AI が次にすべき action を明示する。
 */
export function renderDecisionMessage(
  decision: PathDecision,
  candidateBinDirs: string[],
): string | null {
  switch (decision.kind) {
    case "ok":
      return null;
    case "missing": {
      const candidates =
        candidateBinDirs.length > 0
          ? candidateBinDirs.map((d) => `  - ${d}`).join("\n")
          : "  (HOME 内の PATH 上 bin ディレクトリが見つかりません)";
      return `[cmux-msg] PATH 上に \`cmux-msg\` が見つかりません。
最新版の実体: ${decision.targetBin}

PATH に通すため、以下から symlink を貼るディレクトリをユーザに提示して許可を得てから symlink を作成してください:
${candidates}

実行例: \`ln -s ${decision.targetBin} <選んだディレクトリ>/cmux-msg\``;
    }
    case "outdated-symlink":
      // hook 側で自動更新するので AI への action は不要。観測ログとして 1 行残す。
      return `[cmux-msg] PATH 上の \`cmux-msg\` symlink を最新版に更新しました: ${decision.pathBin} → ${decision.targetBin}`;
    case "mismatched-non-symlink":
      return `[cmux-msg] PATH 上の \`cmux-msg\` (${decision.pathBin}) が symlink ではないため自動更新しません。
最新版の実体: ${decision.targetBin}

ユーザに確認の上、必要なら手動で置換してください (例: rm ${decision.pathBin} && ln -s ${decision.targetBin} ${decision.pathBin})。`;
  }
}

/**
 * PATH の各エントリから「HOME 内かつ書き込み可能そうな bin 系ディレクトリ」を抽出。
 * 純粋関数: PATH 文字列と home prefix、そして「ディレクトリが存在し書き込み可能か」の判定関数を受け取る。
 */
export function pickHomeBinCandidates(
  pathEnv: string,
  homePrefix: string,
  isUsableDir: (p: string) => boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pathEnv.split(":")) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (!p.startsWith(homePrefix + "/") && p !== homePrefix) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    if (!isUsableDir(p)) continue;
    out.push(p);
  }
  return out;
}
