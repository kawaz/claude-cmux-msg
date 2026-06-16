# 2026-06-16 file watcher 比較 (subscribe の event-driven 化 / cmux 撤廃)

cmux-msg は subscribe を旧来 `cmux wait-for` シグナル待ちで実装していたが、cmux 廃止に伴いファイルシステムイベント駆動に置き換える。本 finding はその採用候補 (`Bun fs.watch` / `@parcel/watcher`) を実機検証した記録。

## 判明した事実

- **macOS Bun 1.3.13 では `Bun fs.watch` が atomic rename パターン (tmp → rename(final)) を欠落なく拾える**。Bun issue [#3657](https://github.com/oven-sh/bun/issues/3657) (2025-11 時点 active と報告) は **macOS の現行 Bun では本検証パターンで再現せず**。事前調査では Bun fs.watch を不採用とした論拠が「macOS では当たらない」状態。
- **`@parcel/watcher` も同条件で欠落なく動作**。Bun 1.3.13 配下で postinstall (`bun pm trust @parcel/watcher`) → `watcher.subscribe()` がそのまま機能。`type: "create"` で意味が明確、`path` も絶対パス。
- **100 件 / 17ms 高頻度書込でも両者ともに欠落 0**。Bun fs.watch も @parcel/watcher も rapid succession 耐性あり。
- **Bun fs.watch の event 型は `"rename" | "change"` の 2 種のみ**。新規 / 削除を直接区別しない。後段で「該当 file が存在するか」確認して disambiguate する必要あり (cmux-msg の inbox 用途では「新規 file 到着の検出 + ファイル名抽出」だけで足りるので問題なし)。
- **依存追加なしで Bun 標準だけで足りる見込み**。kawaz の方針 (`design-priority.md` / 無駄な依存追加を避ける) に整合。

## 実用的な示唆 / ベストプラクティス

- **第一候補は `Bun fs.watch`**。依存ゼロ、event 欠落なし、rapid 100 件耐性あり (macOS 検証済)。
- **次善は `@parcel/watcher`**。Linux 環境で `Bun fs.watch` に問題が発覚した場合の切替先。`type` セマンティクス (create/update/delete) が明確な分、disambiguation が要らない利点はある。
- **未検証のため要追加検証**: Linux (inotify) 上の挙動、recursive 監視、watch 中のディレクトリ削除→再作成 (T5)、長時間連続実行下のメモリ・FD リーク。
- **subscribe 実装方針**: `fs.watch(<base>/<sid>/inbox)` で event を購読し、新規ファイル名のみ拾う。起動時に `readdir` で catch-up + `<base>/<sid>/.watermark` に最後に emit した filename を永続化 (= agmsg `watch.sh:216-231` パターン借用)。FSEvents の coalesce 遅延も watermark で吸収可能。
- **二重起動防止**は別レイヤで `ln` (hard link) atomic + mkdir double-check (= agmsg `actas-lock.sh:121,154-178` パターン借用)。これは Bun fs.watch / @parcel/watcher どちらを採用しても変わらない。

## 検証の詳細

### 環境

- OS: macOS Darwin 25.5.0 (Apple Silicon)
- Bun: 1.3.13
- @parcel/watcher: 2.5.6
- 検証 dir: `/tmp/cmsg-watcher-{t1,t2,t4,t4p}/inbox`

### T1: Bun fs.watch / 5 件 atomic rename / 200ms 間隔

期待: 5 件すべての event を取得。事前調査の予測は #3657 の再現 (1 件で止まる)。

結果:

| metric | 値 |
|---|---|
| total_events | **5** (期待 5) |
| elapsed_ms | 1511 |
| eventType | `rename` × 5 |
| filename | `msg-1.md` ... `msg-5.md` 全件 |
| 欠落 | **0** |

`#3657` は macOS 現行 Bun では再現せず。

### T2: @parcel/watcher / 5 件 atomic rename / 200ms 間隔

期待: 5 件すべて。

結果:

| metric | 値 |
|---|---|
| total_events | **6** (5 件 + 監視開始時の dir 初期化 1 件) |
| elapsed_ms | 1517 |
| type | `create` × 6 |
| 欠落 | **0** |

`type: "create"` で意味明示、`path` は絶対パス。

### T4: 高頻度 (100 件 / 1ms 間隔目標)

両者とも欠落 0:

| watcher | N | write_elapsed_ms | total_events | unique | missing |
|---|---|---|---|---|---|
| Bun fs.watch | 100 | 17 | 100 | 100 | **0** |
| @parcel/watcher | 100 | 16 | 101 (= 100 + init dir) | 101 | **0** |

write 自体が 17ms で終わる速度。両 watcher とも安定停止 (2s 追加待機) 後の集計で全件取得。

### 未実施 (優先度・実施タイミング)

- **T3 (Linux inotify)**: CI Ubuntu または Linux 環境で T1/T2/T4 を再実行。本 findings の結論を最終確定するための要件。**優先度: 中**。CI に組み込むのが筋。
- **T5 (watch 中の dir 削除→再作成)**: inotify 仕様 (watch descriptor 失効) に該当するため、subscribe の recovery 戦略に直結。`watcher.on('close')` 相当の検知 + 自前 re-watch の必要性を確認。**優先度: 中**。
- **長時間 (24h) 連続動作**: FD / メモリリーク確認。**優先度: 低** (実用上は subscribe を SessionEnd で確実に閉じる運用)。
- **recursive 監視**: cmux-msg の inbox は単一階層 (= `<base>/<sid>/inbox/*.md`) なので不要。

### 検証スクリプト

scratch dir: `/Users/kawaz/.claude-personal/jobs/aa39f05c/tmp/watcher-test/` (job 終了時に削除)

- `t1-bun-fs-watch.mjs` / `t2-parcel-watcher.mjs` / `t4-bun-rapid.mjs` / `t4-parcel-rapid.mjs`
- いずれも `bun <script>` で再現可能、scratch dir を再構築すれば再実行可

### 関連

- 事前調査: 本セッション内のサブエージェント調査 (Bun fs.watch 不採用と判定したが、macOS 現行 Bun では再現しなかった)
- 借用: agmsg `watch.sh:216-231` (watermark 永続化) / `actas-lock.sh:121,154-178` (ln atomic 排他)
- 次手: DR-0012 「subscribe 確実化 (event-driven + watermark + ln atomic)」で本結果を pin
