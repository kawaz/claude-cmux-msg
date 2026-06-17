---
description: 自セッションの inbox にあるメッセージ一覧を表示。未読 (= 受信済で未 accept/dismiss/reply) のものが出る。
disable-model-invocation: true
model: haiku
context: fork
agent: general-purpose
---

ユーザの slash command。`${CLAUDE_PLUGIN_ROOT}/bin/cmux-msg list` を Bash で実行して結果をそのまま表示してください。

引数なし。inbox に何もなければ「(inbox は空です)」と出る。本コマンドは inbox 内容を読まず、ファイル名一覧 + 送信者だけを返す軽量版。本文を読むには `/cmux-msg:read <filename>` を使う。
