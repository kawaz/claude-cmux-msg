# Roadmap

将来検討中の項目。確定したら DR を立てる。

## 検討中の改善

### CLI 引数パーサの統一

各サブコマンドが独自に `args.includes("--xxx")` 等で引数を解釈しており、`spawn` の `--name X`、`history` の `--peer X`、`thread` の `--json` など実装が分散。`=` 形式 (`--name=X`) は通らない、空文字値の検証も雑。

検討案:
- `mri` / `minimist` 系の軽量パーサを導入
- もしくは自前で `parseArgs(args, schema)` を 1 つ書いて全 cmd で使う

優先度低。動いている。

### subscribe の SIGINT/SIGTERM リスナー累積

`subscribe.ts` で `process.on("SIGINT", stop)` を登録するだけで `removeListener` していない。process がそのまま終わるためリークではないが、テストで複数回 import すると累積する。

修正: `process.once` に変更、または明示的に removeListener。優先度低。

### peers --all で death since 表示

dead セッションの「いつから dead か」を表示できると gc 対象の判断が早い。ただし pid ファイルには alive 時の起動時刻 (lstart) しか記録していない。dead 検出時の時刻を別途記録する仕組みが要る (例: `<peer>/dead_at` ファイル)。優先度低、要設計。

### broadcast の意味論

現状は 1 broadcast = N 件の独立メッセージで、共通の `broadcast_id` だけ付く (0.19.0)。pub/sub 的に「1 件だけ自分のディレクトリに置いて受信側が pull」モデルの方が筋がいい可能性。要 DR 検討。

### message.ts 統合テストの拡充

`reply` 途中失敗時のトランザクション挙動 (送信成功 + archive 失敗 → 再 reply で冪等) は 0.19.0 で対応したが、`accept` 後の異常系、broadcast の部分失敗などは網羅できていない。

## 諦めた / 別件

- spawn の cmux 経由廃止 (シェルインジェクション完全防御): cmux 側に直接 spawn API がないため不可能。0.16.0 の shellSingleQuote で許容範囲を絞った。cmux 上流に PR を投げる必要がある。
- `/rename` `/color` の peers 反映: Claude Code 側に slash command 検知 hook / API が無いため対応不可。詳細は `docs/findings/2026-05-09-claude-slash-command-detection-feasibility.md`。`peers` の name 列は spawn 時の値をそのまま表示する設計に留める。
