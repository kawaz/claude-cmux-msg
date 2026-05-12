/**
 * cwd から walk up して repo の root (.git or .jj の親) を探す。
 *
 * DR-0004 で meta.json の `repo_root` フィールドを埋めるため。
 * `--by repo` でのグルーピングに使う。
 *
 * `.git` は bare repo のディレクトリ自体である可能性もあるので isDirectory
 * チェックはしない (存在すれば repo の root とみなす)。
 */

import * as fs from "fs";
import * as path from "path";

export function detectRepoRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (fs.existsSync(path.join(dir, ".jj"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
