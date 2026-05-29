---
name: cmux-msg-read
description: inbox のメッセージ本文を表示する。引数に ${CLAUDE_PLUGIN_ROOT}/bin/cmux-msg list で見えるファイル名を渡す。
argument-hint: <filename>
disable-model-invocation: true
---

ユーザの slash command。`${CLAUDE_PLUGIN_ROOT}/bin/cmux-msg read $ARGUMENTS` を Bash で実行して結果をそのまま表示してください。

**重要 (将来仕様への先取り注意)**: 現状の `${CLAUDE_PLUGIN_ROOT}/bin/cmux-msg read` は既読マーク (read_at) を書かないので、何もしなくて「人間が見ただけ」状態を保てる。将来 read に auto-accept (= 既読化 + accepted/ 移動) 機能が入った場合は、本 slash 経由では **`--keep-unread` flag を付けて叩く** ように更新してください (= 人間が slash で覗いただけで agent の既読扱いになるのは UX 上望ましくないため)。詳細は `docs/issue/2026-05-28-read-auto-accept.md` 参照。

引数:
- `<filename>` (必須): `${CLAUDE_PLUGIN_ROOT}/bin/cmux-msg list` の 1 列目に出てるメッセージファイル名 (例: `20260527T173014-8c12c596.md`)
