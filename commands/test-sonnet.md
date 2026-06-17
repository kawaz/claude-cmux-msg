---
description: 検証用。model: sonnet (= 200K context、Sonnet 4.6) で動作するか確認するだけのテストコマンド。
disable-model-invocation: true
model: sonnet
context: fork
agent: general-purpose
---

ユーザの slash command (検証用)。以下を実行し、結果を表示してください:

1. Bash で `date '+%Y-%m-%dT%H:%M:%S%z'` を実行
2. 続けて短く「このコマンドは model: sonnet (= 200K context) で動いている」と 1 行宣言する
