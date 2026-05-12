# Roadmap

将来検討中の項目。確定したら DR を立てる。

## 検討中の改善

### Phase 2 候補 (DR-0004 以降)

- **`cmux-msg gc --legacy`**: 旧 `<base>/<ws>/<sid>/` 構造の dir を一掃するヘルパ。DR-0004 の migration C 案で「旧構造は読まない」と決めたため不要だが、ディスクを汚すのが気になるユーザ向け
- **peer 通信のルータプロセス**: 現状ファイル + cmux signal だが、UNIX socket に集約するとモード切替や永続 sub/pub も整理しやすい (DR-0004 で言及した将来構想)
- **state の冪等性向上**: 現在の transitionState は read-modify-write race を守らない (single-process 前提)。Resume 時の hook 競合シナリオで race の可能性

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

### message.ts 統合テストの拡充

`reply` 途中失敗時のトランザクション挙動 (送信成功 + archive 失敗 → 再 reply で冪等) は 0.19.0 で対応したが、`accept` 後の異常系、broadcast の部分失敗などは網羅できていない。

## 諦めた / 別件

- spawn の cmux 経由廃止 (シェルインジェクション完全防御): cmux 側に直接 spawn API がないため不可能。0.16.0 の shellSingleQuote で許容範囲を絞った。cmux 上流に PR を投げる必要がある。
- `/rename` `/color` の peers 反映: Claude Code 側に slash command 検知 hook / API が無いため対応不可。詳細は `docs/findings/2026-05-09-claude-slash-command-detection-feasibility.md`。`peers` の name 列は spawn 時の値をそのまま表示する設計に留める。
