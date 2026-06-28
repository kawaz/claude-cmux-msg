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
# ラッパーは bun で src/cli.ts を直接実行する (bun が必須要件)。

[[ -o interactive ]] || return 0

# 補完用 fpath
if [[ -d "${0:h}/completions" ]]; then
  fpath=("${0:h}/completions" $fpath)
fi
