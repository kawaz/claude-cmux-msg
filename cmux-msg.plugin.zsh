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
# 実装: 同梱の bin/cmux-msg (bash ラッパースクリプト) を alias で指す。
# ラッパー側でコンパイル済み bin/cmux-msg-bin があれば exec、
# なければ bun run src/cli.ts にフォールバックする。

[[ -o interactive ]] || return 0

alias cmux-msg="${0:h}/bin/cmux-msg"

# 補完用 fpath
if [[ -d "${0:h}/completions" ]]; then
  fpath=("${0:h}/completions" $fpath)
fi
