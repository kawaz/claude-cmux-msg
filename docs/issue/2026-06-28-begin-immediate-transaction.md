---
title: subscriber-state / message-queue の db.transaction() を BEGIN IMMEDIATE に変更
status: open
category: bug
created: 2026-06-28T15:22:44+09:00
last_read:
open_entered: 2026-06-28T15:22:44+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: claude-cmux-msg
---

# subscriber-state / message-queue の db.transaction() を BEGIN IMMEDIATE に変更

## 概要

`src/lib/subscriber-state.ts` (tryAcquireLock) と `src/lib/message-queue.ts` の `db.transaction(...)` がデフォルトの `BEGIN DEFERRED` で開始する。READ → WRITE upgrade window で他 writer が WAL を取ると `SQLITE_BUSY_SNAPSHOT` が即時 throw され、busy_timeout=5000ms による retry が効かない (SQLite 仕様)。

## 背景

issue `2026-06-27-subscribe-lock-cross-session-contention` 調査中の workflow が実機 (20 worker × 10 runs = 200 試行) で計測:

- DEFERRED transaction: **16.0% で SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT エラー**
- BEGIN IMMEDIATE: **0.0% (p99 5.8ms、最大 8.4ms)**
- 本物の `tryAcquireLock` 実装でも 20 並行 × 10 runs で **12.2% で throw**

`docs/findings/2026-06-17-bun-sqlite-concurrency.md` の T2 と `message-queue.ts:5` のコメントは BEGIN IMMEDIATE を言及するが、実コードは plain `db.transaction()` のまま (= コメントと実装が乖離)。

throw された場合の挙動:

- `subscribe.ts:205-216`: catch block で `[warning] subscribe DB lock skipped` に流れて **lock なしで継続** (= 別 issue "SQLITE_BUSY 握り潰し silent failure" を誘発)
- 他経路: send / broadcast 系で書き込み失敗時に user 可視のエラーになる可能性

## 修正方針

`db.transaction(...)` を `db.transaction(...).immediate()` (= BEGIN IMMEDIATE) に変更:

- `src/lib/subscriber-state.ts` の `tryAcquireLock`
- `src/lib/message-queue.ts` の transaction 利用箇所すべて

## 受け入れ条件

- [ ] 20 worker 並行 × 10 runs で SQLITE_BUSY_SNAPSHOT が 0 件になる
- [ ] 既存 test が全 pass
- [ ] subscribe.ts の catch block は維持 (= silent failure 修正は別 issue)
