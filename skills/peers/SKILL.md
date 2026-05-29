---
name: peers
description: cmux-msg の peer 一覧 (= 他セッション) を cwd 付きで表示。--by cwd:<pat> で部分一致 grep、--all で全 home 横断、-v で ws/tags/home 詳細。
argument-hint: [--all] [--by cwd:<pat>] [-v|--verbose] [--include-dead]
disable-model-invocation: true
---

ユーザの slash command。`cmux-msg peers $ARGUMENTS` を Bash で実行して結果をそのまま表示してください。

引数なしの場合は `cmux-msg peers` (= 自 claude_home の alive peer を cwd 表示)。

実行例:
- `/cmux-msg:peers` → 自 home の alive peer 一覧
- `/cmux-msg:peers --all` → 全 home 横断
- `/cmux-msg:peers --by cwd:hyoui` → cwd に hyoui 含む peer (substring grep)
- `/cmux-msg:peers --all -v` → 全 home + ws/tags/home 詳細

結果は plain text の table 形式。Claude 側で再フォーマットや解釈は不要、bash の stdout をそのまま user に見せる。
