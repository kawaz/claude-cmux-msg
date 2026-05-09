# spawn トラブルシューティング

`cmux-msg spawn` が完了表示は出すのに子 CC の `meta.json` が永続化されていない、`cmux-msg peers` に現れない、`cmux-msg screen` / `stop` で「meta.json なし」エラーになる場合の切り分け。

関連: `docs/issue/2026-05-09-spawn-claude-not-launching.md`

## 症状の例

```bash
$ cmux-msg spawn worker-x --cwd /path/...
警告: Claude起動の signal を受信できず (30秒タイムアウト)
spawn完了:
  id:      66df8728-219d-4272-9943-f1a418ce675b
  ...

$ cmux-msg peers
# self のみ、66df8728-... が見えない

$ cmux-msg screen 66df8728-219d-4272-9943-f1a418ce675b
エラー: session 66df8728-... が見つかりません (meta.json なし)
```

## 原因の切り分け

spawn は子 CC が `cmux-msg:spawned-<sid>` を signal するまで `cmux wait-for` で待つ (30 秒)。signal が出ない原因は順に:

1. **claude プロセスが起動していない** (新しいペインに claude のプロンプトが表示されない)
   - `cmux-msg screen <sid>` ※ meta.json なしで失敗するため、`cmux list-panes` 等で直接ペインを確認
   - `cmuxNewSplit` は成功したが、その後の `cmuxSend` (claude 起動コマンド送信) が空打ちされている可能性
2. **claude は起動したが SessionStart hook が実行されていない**
   - hook の登録ミス (plugin の install / update が漏れている)
   - `claude plugin list` で cmux-msg が enabled か確認
3. **SessionStart hook が走ったが initWorkspace が失敗している**
   - 0.25.0 以降は `main().catch` で **stderr にエラー詳細を出す**ようになった (debug log に流れる)
   - 子 CC のペインを開いて何かエラーが画面に出ていないか確認
4. **initWorkspace が成功したが cmuxSignal が失敗している**
   - signal 失敗は session-start.ts 内で握り潰されている。signal なしでも meta.json は永続化されているはずなので、`cmux-msg peers --all` で dead としてでも見えるはず

## 対処

### 取り残された session を掃除

`cmux-msg gc --force` で `inbox/` と `accepted/` が両方空の dead session を削除できる。`archive/` `sent/` も一緒に消える点に注意。

### 警告を再現させて詳細ログを取る

子 CC のペインに張り付いて以下を確認:

```bash
# 期待される表示
[cmux-msg:spawned-worker]
parent_session_id: ...
worker_name: ...
session_id: ...
```

これが出ていないなら hook が動いていない / 失敗している。`stderr [cmux-msg session-start hook error]` の行を探す。

### 現状の制約

リファクタ進行中 (`docs/decisions/DR-0002-sandbox-and-peer-listing.md`) のため、過渡的な不整合が起きうる。再現したらこの runbook と issue にケースを追記。

## 履歴

- 2026-05-09: 防御的改善として spawn 警告メッセージにヒント追加 + session-start.ts の catch でエラー詳細を stderr へ流すように変更 (cmux-msg-impl ワーカー)
