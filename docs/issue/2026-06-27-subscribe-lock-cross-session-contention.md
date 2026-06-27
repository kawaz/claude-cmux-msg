---
title: subscribe lock の cross-session 競合
status: open
category: bug
created: 2026-06-27T00:00:05+09:00
last_read:
open_entered: 2026-06-27T00:00:05+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: kuu.mbt
---

# subscribe lock の cross-session 競合

## 概要

同一 host 上で複数 claude セッションが動作中、それぞれの subscribe を Monitor で起動しようとすると `[error] subscribe lock を取得できませんでした (= 他プロセスが既に subscribe を保持中)` で即 exit する。各セッションの session_id は別 (= 受信箱パスも別) なのに lock 取得が競合する。

## 背景

[[2026-06-24-detect-subscribe-false-negative-no-sid-flag]] の追記で言及した「別 issue 化したい lock 競合」を切り出したもの。本筋 (false negative) とは独立した問題。

### 再現状況

session A (sid `69aca323-...`) で:
- 自分の subscribe (PID 3952) は alive (bun process が走っている)
- 別 session B (sid `4285658F-...`、ast-spec ws) も subscribe (PID 別) を保持

session A で Monitor 経由で再度 subscribe を起動すると:
```
[error] subscribe lock を取得できませんでした (= 他プロセスが既に subscribe を保持中)。終了します。
```

→ 自セッション分の subscribe を起動し直したいだけなのに、何かしらの global / cross-session lock が効いて新規 subscribe を弾く。

### 想定される仕様 vs 実装の乖離

- 期待: subscribe lock は **session 単位** (= 受信箱 dir 単位)。session A の subscribe と session B の subscribe は独立に並列起動できるべき
- 実態: 一つでも subscribe が走っていると別 session も含めて新規起動を弾いている挙動に見える
- もしくは自セッション内で「subscribe 1 個 / sid」の制約があり、既存 PID 3952 が `cmux-msg subscribe` 直叩きでなく `bun run .../cli.ts subscribe` 経路で起動されているため lock holder 検出が混乱

### 環境

- macOS Darwin 25.5.0
- cmux-msg v0.30.13
- 複数 claude セッション (`claude "プロンプト"` 直起動形式) 並列稼働

## 受け入れ条件

- [ ] 異なる session_id を持つ subscribe が同一 host 上で並列起動できる
- [ ] 同一 session_id の二重起動のみ lock で弾く (既存の意図した挙動を保持)
- [ ] cross-session lock と intra-session lock の競合スコープが正しく分離されている

## TODO

<!-- wip 時のみ -->

- [ ] lock ファイルのパスを調査 (global 単一 vs session 単位のどちらか)
- [ ] 検証 1: session A の subscribe を kill → 再起動が成功するか
- [ ] 検証 2: session A の subscribe alive のまま session B で新規 subscribe 起動 → fail するか
- [ ] 検証 3: 純粋に自セッション内の二重起動だけ fail するか (cross-session lock との切り分け)

## 追加観察 (2026-06-27, 真の root cause 特定)

`lsof -p <subscribe-pid>` でロック対象を確認したところ、subscribe プロセスが握っているのは **全 session 共有の SQLite DB**:

```
bun     3952  cwd      DIR  /Users/kawaz/.local/share/cmux-messages
bun     3952    5u     REG  /Users/kawaz/.local/share/cmux-messages/cmux-msg.db
bun     3952    6u     REG  /Users/kawaz/.local/share/cmux-messages/cmux-msg.db-wal
bun     3952    7u     REG  /Users/kawaz/.local/share/cmux-messages/cmux-msg.db-shm
```

- `cmux-msg.db` は **全 session 共通の 1 ファイル** (= `/Users/kawaz/.local/share/cmux-messages/cmux-msg.db`)
- SQLite WAL モード (`.db-wal` / `.db-shm` あり)
- subscribe プロセスは DB レベルで lock を取り、SQLite のシリアライゼーション制約に従う

これが「**仕様 vs 実装の乖離**」項目で書いた **(1) cross-session lock** に該当する。session_id 別に分かれた受信箱ディレクトリ運用にも関わらず、内部の SQLite DB は全 session 共有のため、subscribe の lock も自動的に cross-session になる。

### 結果として起こる症状

- 別 session の subscribe が稼働中なら新規 subscribe は lock を取れない (= 同時稼働不可)
- session A を起動した後に session B を起動した時、session B の subscribe 起動が即失敗する
- Monitor で何度 subscribe を再起動しようとしても、別 session の subscribe が alive な限り失敗し続ける

### 観察した稼働中 subscribe 一覧

`ps -axww | grep "subscribe"` の結果、以下のセッションが並列稼働中:
- sid `4285658F-...` (ast-spec ws) — PID 3952
- sid `0ab6ca63-...` (timespec-mbt)
- sid `acad9f77-...` (grapheme-mbt) — PID 4040 等
- sid `8bcb7267-...` (die)
- sid `56eb9cbc-...` (bump-semver)

→ 7+ セッションの中で、subscribe lock を最初に取れた 1 セッションだけが subscribe を維持できる構造。

### 対策方向

**SQLite の lock は session 毎に独立した DB ファイルに分割** すれば cross-session 競合は解消する:

- 案 1: 各 session 専用 DB (= `<base>/<sid>/cmux-msg.db`) に分割
  - メリット: lock 完全独立
  - デメリット: DB マージが必要 (= 別 session 宛 send / broadcast の配送経路)
- 案 2: 全 session 共通 DB を維持しつつ subscribe の lock 取得方式を非 SQLite 化
  - 例: lockfile (`<base>/<sid>/.subscribe.lock`) を flock で取る
  - subscribe は DB を読みに行く時だけ短時間 SQLite lock を取り、長期保持はしない
  - メリット: DB 構造変更不要
  - デメリット: subscribe ロジックの書き直しが必要

案 2 のほうが現状互換性高そう。

### priority 上げ提案

[[2026-06-24-detect-subscribe-false-negative-no-sid-flag]] と組み合わさると「false negative → Monitor 再試行 → lock 競合 → 自セッションで subscribe 無し」の連鎖が起こる。並列セッション運用が前提のユーザ環境では実害大なので **priority: high** 推奨。
