/**
 * `~/.local/share/cmux-messages/` 各階層に「ここは何の場所か」を説明する
 * README.md を symlink として配置する。
 *
 * - 原本は `<MSG_BASE>/.docs/v<version>/layout-{root,workspace,session}.md`
 *   (プラグイン内 `docs/layout/` から SessionStart hook 起動時にコピー)
 * - `<MSG_BASE>/.docs/latest -> v<version>` を current 版として向ける
 * - 各階層の README.md は `.docs/latest/layout-*.md` への相対 symlink
 *
 * 既に同じ symlink target が存在する場合は何もしない。冪等。
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

const LAYOUT_FILES = [
  "layout-root.md",
  "layout-workspace.md",
  "layout-session.md",
] as const;

/**
 * symlink を冪等に作る。既存 symlink が同じ target を指していれば何もしない。
 * 違う target を指していれば tmp に作って rename で atomic に差し替える。
 * 既存が symlink でない（regular file 等）なら触らない（ユーザのファイルかもしれない）。
 */
function ensureSymlink(linkPath: string, target: string): void {
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(linkPath);
      if (current === target) return;
      // target 違い → 差し替え
    } else {
      // 既存が regular file 等 → 触らない
      return;
    }
  } catch {
    // 無いだけなら作る
  }
  // 同 PID で並列実行された場合の衝突を避けるため random 8 文字を加える
  const tmp = `${linkPath}.tmp.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    fs.symlinkSync(target, tmp);
    fs.renameSync(tmp, linkPath);
  } catch (e) {
    // symlink 不可な環境（Windows 等）では諦める。README が無いだけで本機能は動く
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/**
 * `.docs/v<version>/` を作って plugin 内の docs/layout/ からコピー。
 * 既に存在すれば何もしない（バージョン bump 時のみコピー）。
 */
function ensureVersionedDocs(
  msgBase: string,
  pluginRoot: string,
  version: string
): boolean {
  const versionDir = path.join(msgBase, ".docs", `v${version}`);
  if (fs.existsSync(versionDir)) return true;

  const sourceDir = path.join(pluginRoot, "docs", "layout");
  if (!fs.existsSync(sourceDir)) return false;

  fs.mkdirSync(versionDir, { recursive: true });
  for (const f of LAYOUT_FILES) {
    const src = path.join(sourceDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(versionDir, f));
    }
  }
  return true;
}

/**
 * `.docs/latest` を v<version> に向ける。既に向いていれば何もしない。
 */
function ensureLatestSymlink(msgBase: string, version: string): void {
  const latest = path.join(msgBase, ".docs", "latest");
  ensureSymlink(latest, `v${version}`);
}

export interface SetupLayoutOptions {
  msgBase: string;
  pluginRoot: string;
  workspaceId: string;
  sessionId: string;
  version: string;
}

/**
 * 全階層の layout README をセットアップ。SessionStart hook の initWorkspace から呼ばれる。
 * 失敗してもメッセージング機能には影響しないため throw しない。
 */
export function setupLayoutDocs(opts: SetupLayoutOptions): void {
  try {
    const ok = ensureVersionedDocs(opts.msgBase, opts.pluginRoot, opts.version);
    if (!ok) return; // plugin 内 docs/layout/ が無い → 何もしない
    ensureLatestSymlink(opts.msgBase, opts.version);

    // root: ~/.local/share/cmux-messages/README.md → .docs/latest/layout-root.md
    ensureSymlink(
      path.join(opts.msgBase, "README.md"),
      path.join(".docs", "latest", "layout-root.md")
    );

    // workspace: <ws>/README.md → ../.docs/latest/layout-workspace.md
    if (opts.workspaceId) {
      ensureSymlink(
        path.join(opts.msgBase, opts.workspaceId, "README.md"),
        path.join("..", ".docs", "latest", "layout-workspace.md")
      );
    }

    // session: <ws>/<sid>/README.md → ../../.docs/latest/layout-session.md
    if (opts.workspaceId && opts.sessionId) {
      ensureSymlink(
        path.join(opts.msgBase, opts.workspaceId, opts.sessionId, "README.md"),
        path.join("..", "..", ".docs", "latest", "layout-session.md")
      );
    }
  } catch {
    // README は補助情報なので失敗しても黙殺
  }
}
