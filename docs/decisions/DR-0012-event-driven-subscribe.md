# DR-0012: subscribe を file system イベント駆動 + watermark + ln atomic 排他に切替

- Status: Accepted (2026-06-17, kawaz 一括承認)
- Date: 2026-06-16
- Related: [DR-0004](DR-0004-session-as-primary-key.md) (sid 主体), [DR-0008](DR-0008-messaging-needs-only-session-id.md) (messaging は cmux 非依存), 本草稿の根拠 findings: `docs/findings/2026-06-16-file-watcher-comparison.md`
- Borrowed from: agmsg `watch.sh:216-231` (watermark 永続化), `actas-lock.sh:121,154-178` (ln atomic + mkdir double-check)

## 背景

`subscribe` は inbox の新規 message 到着を検知して JSONL で stdout に流す long-running プロセス。現行実装は cmux の `wait-for` シグナル待ちに依存しているが、本リポは cmux 全廃に方針転換した (DR-0009 群)。
代替手段は file system イベント駆動だが、

- **どの watcher を使うか** (Bun fs.watch / @parcel/watcher / chokidar / fs.watchFile polling)
- **起動時の catch-up と event coalesce 遅延の吸収**
- **同一 sid に subscribe が複数同時起動するのを防ぐ排他**

の 3 点を仕組みとして決める必要がある。

## 決定

### 1. watcher は `Bun fs.watch` を採用 (依存追加なし)

実機検証 (findings 2026-06-16) で以下を確認:

- macOS Bun 1.3.13 で atomic rename (tmp → rename(final)) パターンを欠落なく取得
- 100 件 / 17ms 高頻度書込でも欠落 0
- Bun issue [#3657](https://github.com/oven-sh/bun/issues/3657) (2025-11 active 報告) は **本検証パターン (macOS)** では再現しなかった

event 型は `"rename" | "change"` の 2 種類のみで新規 / 削除を直接区別しないが、cmux-msg の inbox 用途では「event を受けて該当 file が存在するか確認 → 新規なら emit」という後段 disambiguate で足りる。

### 2. 起動時 catch-up + watermark 永続化

subscribe 起動時にまず `readdir(<base>/<sid>/inbox)` で既存ファイルを列挙し、`<base>/<sid>/.subscribe-watermark` に永続化した「最後に emit した filename」より後のものを catch-up で emit する。
新規 event 検知時も watermark を更新する。これにより:

- subscribe の再起動 / クラッシュ後の再開で取りこぼし無し
- 万一 FSEvents の coalesce (macOS 仕様、~200ms) で event が遅延しても catch-up で吸収
- subscribe 停止中に到着したメッセージも次回起動で確実に流れる

watermark 書き込みは `tmp → rename` で atomic。

### 3. 二重起動防止は `ln` (hard link) atomic + mkdir double-check

`<base>/<sid>/.subscribe.lock` を hard link で原子的に取得し、stale lock 解除には `mkdir <base>/<sid>/.subscribe.lock.mutex` をセカンドガードとして使う (= agmsg `actas-lock.sh` パターン)。
PID と起動時刻を lock file に書き、再起動時の自己 stale 判定は PID 生存 + 起動時刻一致で行う。

これにより:

- 同一 sid に subscribe が同時 2 つ起動するのを防げる (現状 open issue: `docs/issue/2026-06-02-subscribe-double-launch-prevention.md` の解決)
- 旧プロセス crash 後の stale lock も double-check で安全に解除可

## 不採用

- **`@parcel/watcher` を第一候補にすること**: 事前調査では Bun fs.watch を不採用とした論拠 (#3657) が macOS 現行版では再現せず、依存追加の正当化が消えた。Linux 環境で問題が出た場合に切り替える次善候補としては維持する。`kawaz` の依存最小化方針 (`design-priority.md`) に整合。
- **`chokidar`**: 内部で `fs.watch` を呼ぶので Bun ランタイム上では fs.watch と同じ症状を継承する (chokidar maintainer 自身が Bun 不調を明言、findings 参照)。Bun fs.watch で足りる以上、層を増やす理由がない。
- **`fs.watchFile` (polling)**: CPU を食う、レイテンシが悪い。第一候補が動かない場合の最終退避として位置づける。
- **`hyoui lock` 経由の排他**: hyoui の lock は tty 注入の race 防御という別目的のプリミティブ。subscribe の二重起動防止は cmux-msg の責務 (本リポ内のディレクトリ状態に対する排他) であって、機能違い。

## Linux 検証の宿題

本決定は macOS 検証のみで Linux (inotify) は未検証。**採用前提として Linux で T1/T2/T4 (findings 参照) を再実行**し、欠落 0 を確認する。CI に組み込むのが筋。
Linux で問題が出た場合は速やかに `@parcel/watcher` への切替を検討する (本 DR は Linux 検証 NG なら Superseded で書き直す方針)。

## 影響範囲

- `src/commands/subscribe.ts`: `cmuxWaitFor` シグナル待ちを `fs.watch` ベースに書き換え
- `src/lib/subscribe-watch.ts`: イベント駆動 + catch-up + watermark + ln 排他のロジック
- watermark file 仕様 (`<base>/<sid>/.subscribe-watermark`): atomic rename で書き込み
- lock file 仕様 (`<base>/<sid>/.subscribe.lock` + `.subscribe.lock.mutex`)
- 既存 issue `docs/issue/2026-06-02-subscribe-double-launch-prevention.md` を本 DR で解決 → sublimation 削除
- 旧 cmux 経路の `subscribe-watch.ts:73-74` の `isSubscribeCommand` ハードコード文字列 (`cmux-msg` / `cli.ts`) は DR-0013 (改名) と整合させる

## 関連 DR (今後)

- DR-0009 (cmux 廃止と hyoui 委譲) と本 DR は独立に land 可能だが、DR-0009 land と同タイミングで land すれば breaking 一括化できる
- DR-0014 (本文 stdin 標準化) とも独立
