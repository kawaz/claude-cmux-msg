# Roadmap

将来検討中の項目。確定したら DR を立てる。

## 検討中の改善

### Phase 2 候補 (DR-0004 以降)

- **state の冪等性向上**: 現在の transitionState は read-modify-write race を守らない (single-process 前提)。Resume 時の hook 競合シナリオで race の可能性

### CLI 引数パーサの統一

各サブコマンドが独自に `args.includes("--xxx")` 等で引数を解釈しており、`history` の `--peer X`、`thread` の `--json` など実装が分散。`=` 形式 (`--name=X`) は通らない、空文字値の検証も雑。

検討案:
- `mri` / `minimist` 系の軽量パーサを導入
- もしくは自前で `parseArgs(args, schema)` を 1 つ書いて全 cmd で使う

優先度低。動いている。

### subscribe の SIGINT/SIGTERM リスナー累積

`subscribe.ts` で `process.on("SIGINT", stop)` を登録するだけで `removeListener` していない。process がそのまま終わるためリークではないが、テストで複数回 import すると累積する。

修正: `process.once` に変更、または明示的に removeListener。優先度低。

### peers --all で death since 表示

dead セッションの「いつから dead か」を表示できると gc 対象の判断が早い。dead 検出時の時刻を別途記録する仕組みが要る (例: `<peer>/dead_at` ファイル)。優先度低、要設計。

### message.ts 統合テストの拡充

`reply` 途中失敗時のトランザクション挙動 (送信成功 + archive 失敗 → 再 reply で冪等) は 0.19.0 で対応したが、`accept` 後の異常系、broadcast の部分失敗などは網羅できていない。
