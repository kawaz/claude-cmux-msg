# 設計議論: Claude Code jsonl 更新ストリーミング監視ループ (kawaz と議論)

別セッションで kawaz と文面ベースで議論する用の起票。

## 背景

`docs/findings/2026-05-09-claude-slash-command-detection-feasibility.md` で、`/rename` `/color` 等の slash command を検知する方法を調査した結果、

- 公式 hook / Plugin API / CLI には slash command 検知手段なし
- 唯一の現実解は `~/.claude/projects/<project-hash>/<session-id>.jsonl` のファイル監視

と確定した。本 issue はこれを cmux-msg のスコープを超えた汎用機構として整備すべきか議論するもの。

## 検討したい設計

`~/.claude/projects/.../*.jsonl` を tail -f 的にストリーム監視するループ (Bun watcher / fswatch / inotify) を提供し、新規行 (event) のパターンマッチで以下のような機能を実装する:

### 直接的なユースケース

- `/rename` `/color` 検知 → cmux-msg meta.json (name / color) を最新に保つ
- `peers` 表示の name 列が常に最新 (現状は spawn 時の値で固定)

### ジェネリックなユースケース (派生)

- セッション内で実行された tool 名・コマンド種別の集計 (作業ログ生成)
- 特定 prompt パターンの検知 (e.g. 「お疲れさま」で session 終了の予兆を伝搬)
- セッション間の cross-link (子 CC が `/rename` した名前を親 CC が peers で見られる)
- handoff / journal の自動生成補助 (「今日の作業内容を取り出してくれ」を tail から再構築)

## 議論したいポイント

### 1. スコープ判断

- cmux-msg のスコープ内に取り込むのか、別 plugin / 別 lib として切り出すのか
- jsonl 監視は claude-cmux-msg 以外のプロジェクト (claude-session-analysis 等) にも有用なので独立させる方が自然?
- claude-session-analysis は既に jsonl を post-mortem で扱っている。**ストリーミング監視機能をそちらに寄せる**選択肢も
- もし共通化するなら、その lib を claude-cmux-msg / claude-session-analysis 双方が depend する形に

### 2. 仕様変動リスク

- jsonl は Claude Code 内部実装。Anthropic が予告なく schema を変えうる
- 対策案:
  - schema バリデータを噛ませて未知フィールドが出たら warning + raw payload pass-through
  - 検知ロジックを「event type 名」「特定 key の有無」程度に限定し、深い構造に依存しない
  - Anthropic 公式に「jsonl 監視 API を提供してくれ」と feature request を上流に投げる (将来の本道)

### 3. 監視ループの実装層

- watcher: `Bun.watch` / Node `fs.watch` / `chokidar` / `fswatch` (macOS) / `inotifywait` (Linux)
- POSIX 互換重視なら fswatch + inotifywait の wrapper、開発容易性重視なら Bun.watch
- 監視ループは long-running daemon (subscribe と類似のパターン)?それとも CC のセッションに紐づく background hook?

### 4. event の配信先

- cmux-msg の inbox に prefix 付きで配信 (`type: claude-event`)
- 別チャネル (UNIX socket / FIFO / 別ディレクトリ)
- `cmux-msg subscribe` のような JSONL stdout で外部ツールが consume

### 5. 認可と prinscibility

- cmux-msg は同一 workspace 内の peer は信頼する設計 (DR-0002)。jsonl 監視を取り込むと、別 session の jsonl を読む権限が必要。`--add-dir ~/.claude/projects/<hash>/` を子 CC の sandbox に許可するか
- 個人マシン前提なら問題ないが、設計上の境界として明文化したい

## 次のアクション

- kawaz と別セッションで本 issue を文面ベースで議論
- 議論の結果として
  - 実装するか / 却下か / 上流に投げるか
  - 実装するならどの lib に置くか (cmux-msg 内 / claude-session-analysis / 新 plugin)
  - schema 変動リスクの許容範囲
- 結論が出たら DR (`docs/decisions/DR-NNNN-jsonl-monitoring-stream.md`) を起票

## 関連

- 検知不可確定の経緯: `docs/findings/2026-05-09-claude-slash-command-detection-feasibility.md`
- 派生要望 (具体ユースケース): `docs/ROADMAP.md` の「諦めた / 別件」 (`/rename` `/color` の peers 反映)
- 並行プロジェクト: `kawaz/claude-session-analysis` (jsonl の post-mortem 解析)
- 過去調査: claude-code-guide agent 経由で公式 doc 確認済 (Hooks: <https://code.claude.com/docs/en/hooks.md>、Plugin API: <https://code.claude.com/docs/en/plugins.md>)

報告者: kawaz (2026-05-09 cmux-msg-impl セッション内の指示)。本 issue は議論起点として立てるのみで、cmux-msg-impl ワーカーは着手しない。
