---
name: cmux-msg-whoami
description: 自セッションの ID 情報 (session_id, workspace_id, cwd, repo_root, claude_home, tags 等) を表示する。
disable-model-invocation: true
---

ユーザの slash command。`cmux-msg whoami` を Bash で実行して結果をそのまま表示してください。

引数なし。`meta.json` 由来の情報を整形して出す。「自分の sid 何だっけ」を確認したい時の最短手段。
