---
description: 自セッションが関わった全メッセージ (送受信) を時系列で表示。--peer <id> で特定相手に絞る、--limit N で件数制限。
argument-hint: [--peer <id>] [--limit N] [--json]
disable-model-invocation: true
---

ユーザの slash command。`${CLAUDE_PLUGIN_ROOT}/bin/cmux-msg history $ARGUMENTS` を Bash で実行して結果をそのまま表示してください。

引数なしで全件時系列表示。フィルタしたい場合:
- `/cmux-msg:history --peer 78de7c22-...` → 特定 peer との往復のみ
- `/cmux-msg:history --limit 20` → 末尾 20 件
- `/cmux-msg:history --json` → JSON 出力 (scripted 用)
