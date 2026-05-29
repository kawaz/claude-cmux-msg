import { requireCmux, getSessionId, myDir } from "../config";
import { readMetaByDir } from "../lib/meta";
import { abbreviateHome } from "../lib/paths";

const WHOAMI_HELP = `使い方: cmux-msg whoami [-v|--verbose]

自セッションの ID 情報を表示する (peers と同じ流儀: cwd 中心、ws は冗長なので
--verbose 時のみ)。

OUTPUT (default):
  session_id: <UUID>
  cwd:        <自 cwd を $HOME → ~ 短縮した文字列>
  state:      <idle/running/awaiting_permission/stopped>
  dir:        <受信箱ディレクトリ>

OUTPUT (--verbose 追加):
  repo_root:  <repo_root を ~ 短縮>
  workspace:  <workspace_id (UUID)>
  home:       <claude_home を ~ 短縮>
  tags:       <CSV>
  name:       <worker_name>`;

export function cmdWhoami(args: string[] = []): void {
  requireCmux();

  if (args.includes("--help")) {
    console.log(WHOAMI_HELP);
    return;
  }
  const verbose = args.includes("--verbose") || args.includes("-v");
  const unknown = args.filter(
    (a) => a !== "--verbose" && a !== "-v" && a !== "--help"
  );
  if (unknown.length > 0) {
    console.error(`不明な引数: ${unknown.join(" ")}\n\n${WHOAMI_HELP}`);
    process.exit(1);
  }

  const sid = getSessionId();
  const dir = myDir();
  const meta = readMetaByDir(dir);

  console.log(`session_id: ${sid}`);
  if (meta?.cwd) {
    console.log(`cwd:        ${abbreviateHome(meta.cwd)}`);
  } else {
    console.log(`cwd:        (no meta — SessionStart hook 未実行?)`);
  }
  if (meta?.state) {
    console.log(`state:      ${meta.state}`);
  }
  console.log(`dir:        ${dir}`);

  if (verbose) {
    if (meta?.repo_root) {
      console.log(`repo_root:  ${abbreviateHome(meta.repo_root)}`);
    }
    if (meta?.workspace_id) {
      console.log(`workspace:  ${meta.workspace_id}`);
    }
    if (meta?.claude_home) {
      console.log(`home:       ${abbreviateHome(meta.claude_home)}`);
    }
    if (meta?.tags && meta.tags.length > 0) {
      console.log(`tags:       ${meta.tags.join(",")}`);
    }
    if (meta?.worker_name) {
      console.log(`name:       ${meta.worker_name}`);
    }
  }
}
