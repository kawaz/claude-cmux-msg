---
description: 検証用。model: sonnet[1m] (= 1M context、Sonnet 4.6 + 1M token window) で動作するか確認するだけのテストコマンド。
disable-model-invocation: true
model: sonnet[1m]
context: fork
agent: general-purpose
---

ユーザの slash command (検証用)。以下を実行し、結果を表示してください:

1. Bash で `date '+%Y-%m-%dT%H:%M:%S%z'` を実行
2. 続けて短く「このコマンドは model: sonnet[1m] (= 1M context) で動いている」と 1 行宣言する
