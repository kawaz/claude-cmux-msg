# 2026-05-09 self-improvement バッチ (cmux-msg-impl セッション)

cmux-msg 自身に蓄積していた `docs/issue/` を、cmux-msg-impl ワーカー CC が連続実装で消していくセッション。親 CC `718c6cc3-b154-4de5-9cbe-cccd6dcfa407` (commander-on-jjworktree) からの一括依頼。

## 実装した issue

### send stdin / --file 対応 (低)

`docs/issue/2026-05-09-send-cannot-read-stdin.md`

`cmux-msg send <id> [<msg>]` で本文省略時に stdin から読み込み、`--file <path>` (`-` は stdin) でファイル指定可能に。`gh pr edit --body-file -` 等の Unix 慣習に揃えた。

実装上の判断:
- `parseSendArgs` / `resolveSendBody` を export してテスト可能に
- 引数省略 + TTY なら usage error (対話入力との誤動作回避)
- `--file` と `<msg>` 同時指定はエラー (曖昧さ回避)

### spawn 引数パース堅牢化 (低)

`docs/issue/2026-05-09-spawn-args-consume-cli-flags.md`

`cmux-msg spawn --help` が `--help` を name に消費して session を起こす問題を修正。

実装上の判断:
- `--help` / `-h` は最優先で処理して return (副作用なし)
- 引数なしは案 B (副作用なくヘルプ表示) を採用
- 不明なフラグはエラー (name に誤消費しない)
- 位置引数は最初の non-option のみ name として採用、二度目以降はエラー
- `parseSpawnArgs` を export してテスト可能に

### spawn 出力に remote URL + --json (中)

`docs/issue/2026-05-09-spawn-output-missing-remote-url.md`

子 CC のリモート URL (`https://claude.ai/code/session_XXX`) を spawn 出力に含めるように。

実装上の判断:
- screen サンプリング heuristic を採用 (Claude Code 側に「URL を返す hook / API」が無いため)。Design rationale をコードコメントに記載
- 取得失敗しても spawn 自体は成功扱い (出力は `(取得できませんでした)` / json では null)
- 通常出力フォーマットを 1 行 `id=... name=... color=...` から複数行 `key: value` に変更 (issue の期待形式)
- `--json` で `{id, name, color, surface_ref, remote_url}` を 1 行 JSON 出力

### inbox 能動通知 (高)

`docs/issue/2026-05-09-inbox-no-active-notification.md`

親 CC が `cmux-msg list` を能動的に打たないと新着に気付けない問題への対応。

実装上の判断:
- 報告者の好みは「案 C: SessionStart hook で subscribe 自動起動」+「案 A: Stop hook で list --new-only」の組み合わせ
- **案 C は物理的に不可能**: SessionStart hook は CC プロセス内で完結する。Monitor は CC のセッションが起動するメインのストリーム機構なので、hook 内から起動できない
- **案 A を UserPromptSubmit hook に変更して実装**: claude-code-guide 調査の結果、`UserPromptSubmit` の stdout は次の Claude ターンに `<system-reminder>` として injection される (Stop hook の stdout は debug log 行きで context injection されない)
- `src/hooks/user-prompt-submit.ts` を追加。`hooks.json` で UserPromptSubmit を登録
- `inbox/` の `.md` 件数 > 0 なら `[cmux-msg] 未読 N 件: cmux-msg list ...` を出す
- ターン**中**には発火しないため、リアルタイム性が必要なら依然として Monitor + `subscribe` 推奨。session-start.ts の親 CC 用メッセージを「**推奨**」と強い文言に変更
- README-ja.md に「補完: UserPromptSubmit hook による未読通知」節を追加

issue 元の問題 (能動通知ゼロ) は緩和されたが、リアルタイム通知は subscribe 任せのまま。完全な自動化 (Monitor 起動を hook から) は Claude Code 側に追加 API が必要。

## 起票した新規 issue

親 CC からの依頼で受領 (本セッション内で着手判断):
- `2026-05-09-rename-color-not-reflected-in-peers.md` (実装側 issue、優先度低)
- `2026-05-09-research-detect-claude-slash-commands.md` (調査 issue、優先度低)

## 残タスク

本セッション内で着手予定:
- `2026-05-09-spawn-claude-not-launching.md`: 再現条件 + meta.json 永続化ロジック調査、または runbook 化
- 上記新規 issue 2 件 (低優先、合間で)
- 全件完了後に version-bump で patch リリース

## 学び

- `jj split` は `--insert-before @` で「過去の change」位置に分離コミットを作れる。同じ working copy で複数関心事をまとめて編集してから後で split できる
- claude-code-guide agent は Anthropic 公式ドキュメント参照込みで Claude Code hook 仕様を 200 語で返してくれる。SessionStart 以外の hook 仕様調査に有用
