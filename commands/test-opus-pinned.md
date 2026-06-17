---
description: 検証用。model: claude-opus-4-8 (= full model name 直指定、200K context 想定、auto 1M アップグレード対象外) で動作するか確認するテストコマンド。
disable-model-invocation: true
model: claude-opus-4-8
context: fork
agent: general-purpose
---

ユーザの slash command (検証用)。以下を実行し、結果を表示してください:

1. Bash で `date '+%Y-%m-%dT%H:%M:%S%z'` を実行
2. 続けて短く「このコマンドは model: claude-opus-4-8 (full name pinned、200K) で動いている」と 1 行宣言する

`opus` alias と違い、full model name 指定では 1M アップグレード対象外
(docs: 「The `[1m]` suffix applies the 1M context window... append `[1m]` to a
full model name」= 明示 suffix 必要)。
