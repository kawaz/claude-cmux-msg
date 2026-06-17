---
description: 検証用。model: opus (= alias、プラン依存で自動 1M アップグレードされる場合あり) で動作するか確認するだけのテストコマンド。
disable-model-invocation: true
model: opus
context: fork
agent: general-purpose
---

ユーザの slash command (検証用)。以下を実行し、結果を表示してください:

1. Bash で `date '+%Y-%m-%dT%H:%M:%S%z'` を実行
2. 続けて短く「このコマンドは model: opus (alias) で動いている」と 1 行宣言する

注意: opus alias は plan によって自動 1M context アップグレードされる場合あり
(Max / Team / Enterprise plan)。1M context なしを確実にしたい場合は full model
name (例: claude-opus-4-8) で指定する。
