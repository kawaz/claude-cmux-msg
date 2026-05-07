# cmux-msg.plugin.zsh
#
# zsh plugin として `cmux-msg` コマンドを使えるようにする。
# zinit / antidote / oh-my-zsh / antigen 等から source される想定。
#
# 例 (zinit):
#   zinit light kawaz/claude-cmux-msg
#
# 例 (手動):
#   source /path/to/claude-cmux-msg/cmux-msg.plugin.zsh
#
# 実装方針:
#   - bun run でソースから直接実行する zsh function として提供
#   - ビルド済み bin/cmux-msg の有無を気にしなくて済む
#   - Claude Code 側 (SessionStart hook) はコンパイル済み bin を使うので高速
#   - シェル側のユーザ操作は function (bun run) で十分。コードも常に最新

[[ -o interactive ]] || return 0

if ! command -v bun >/dev/null 2>&1; then
  return 0
fi

# function 定義時点の plugin ファイルの場所をキャプチャ
typeset -g __CMUX_MSG_ROOT="${0:h}"

cmux-msg() {
  bun run "${__CMUX_MSG_ROOT}/src/cli.ts" "$@"
}

# 補完用 fpath
if [[ -d "${__CMUX_MSG_ROOT}/completions" ]]; then
  fpath=("${__CMUX_MSG_ROOT}/completions" $fpath)
fi
