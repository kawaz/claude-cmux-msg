# 調査: Claude Code 本体の slash command (`/rename` `/color` 等) を cmux-msg 側で検知する手段はあるか

## 背景

`/rename` `/color` などは **Claude Code 本体の slash command** で、cmux-msg のスコープ外で実行される。これらを cmux-msg 側で検知して `meta.json` (name / color フィールド) に反映できれば、`cmux-msg peers` の表示が常に最新になる。

関連 issue (実装側): `2026-05-09-rename-color-not-reflected-in-peers.md` ─ こちらは「実装」の issue。本 issue は **その前提となる「検知が物理的に可能か」の調査** のみを扱う。

## 調査してほしいこと

### 候補 1: Claude Code の hook で取れるか

- 既存の hook 種別 (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`, etc) のどれかで slash command の実行が見えるか
- slash command 専用の hook (例: `SlashCommand`, `CommandStart`, `CommandEnd`) が存在するか / 計画されているか
- hook の payload (event JSON) に `name` / `color` の変更情報が含まれるか
- 参考: `~/.claude/rules/update-config.md` / `~/.claude/settings.json`

### 候補 2: Claude Code の状態ファイルを監視

- `/rename` / `/color` 実行で `~/.claude/projects/...` 配下の何らかのファイルが書き換わるか
- 書き換わるなら `fswatch` / `inotifywait` 等の file watcher で検知可能
- ただし内部実装に依存するので脆い (Claude Code のバージョンアップで壊れる可能性)

### 候補 3: tmux ペイン / status line 経由 (heuristic)

- cmux 環境では Claude Code の TUI に name / color が表示されている可能性 (実証済: `cmux-msg screen <id>` の出力にステータスバーが映る)
- これを定期サンプリングしてパースする heuristic で取得可能か
- 脆い (TUI レイアウト変更で壊れる) が、他に手段がないなら fallback として検討

### 候補 4: Claude Code SDK / API

- `@anthropic-ai/claude-code` SDK や Claude Code Plugin API で session metadata イベントを subscribe できるか
- Plugin マニフェスト (`.claude-plugin/plugin.json`) で「session 状態の変化を受け取る」宣言が可能か
- 公式ドキュメント or `claude-code-guide` agent で確認

### 候補 5: `claude` CLI のサブコマンド

- `claude session info <id>` のような状態取得 CLI が存在するか (現状の `claude --help` で見える範囲)
- 存在すれば cmux-msg が定期 poll で取得できる

## 期待する成果物

このリポの `docs/findings/2026-05-09-claude-slash-command-detection-feasibility.md` (もしくは同名の `research/`) に:

1. 候補 1〜5 の調査結果を「可能 / 不可 / 不明」で分類
2. 可能なものがあれば最も筋の良い実装方針を示す
3. すべて不可なら、その旨を docs/decisions/ または DESIGN.md の「現状の制約」節に明文化する根拠材料にする

## 優先度

**低**。実害は `cmux-msg peers` の表示が古いままになる程度で、通信機能には影響なし。ただし複数子 CC を運用する commander 的な使い方では「peers で各子の現在の作業内容 (name) や色を一覧したい」という需要があり、解決すれば commander UX が大きく改善する。

調査は 30 分〜数時間 (公式ドキュメント探索 + hook 動作確認) で結論が出るはず。実装側 issue (`2026-05-09-rename-color-not-reflected-in-peers.md`) の着手前に本調査を済ませるのが筋。

## 関連

- 実装側 issue: `2026-05-09-rename-color-not-reflected-in-peers.md`
- 既存の hook 関連 issue: `2026-05-09-inbox-no-active-notification.md` (案 C: SessionStart hook で subscribe 自動起動 ─ Claude Code hook の活用例として参考になる)
- 親側で実証済の手法: Monitor + `cmux-msg subscribe` の組み合わせ (commander-on-jjworktree で稼働中)

報告者: 親 CC `718c6cc3-b154-4de5-9cbe-cccd6dcfa407` (commander-on-jjworktree、kawaz の指示に基づき起票) — 2026-05-09
