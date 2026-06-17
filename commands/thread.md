---
description: メッセージファイルを起点に in_reply_to を辿って会話単位で時系列表示する。
argument-hint: <filename> [--json]
disable-model-invocation: true
---

ユーザの slash command。`${CLAUDE_PLUGIN_ROOT}/bin/cmux-msg thread $ARGUMENTS` を Bash で実行して結果をそのまま表示してください。

引数:
- `<filename>` (必須): 起点となるメッセージファイル名 (例: `20260527T173014-8c12c596.md`)
- `--json` (option): JSON 出力 (scripted 用)

`in_reply_to` の連鎖を辿って「ある会話」を 1 つの thread として並べる。`list` で見えてる単発メッセージから会話全体を遡って見たい時に使う。
