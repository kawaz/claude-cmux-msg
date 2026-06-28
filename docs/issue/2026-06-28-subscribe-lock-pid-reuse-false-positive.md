---
title: subscribe lock の PID 再利用 false-positive 対策
status: open
category: bug
created: 2026-06-28T15:25:29+09:00
last_read:
open_entered: 2026-06-28T15:25:29+09:00
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

# subscribe lock の PID 再利用 false-positive 対策

## 概要

`tryAcquireLock` (`src/lib/subscriber-state.ts`) と `isProcessAlive` (`src/lib/peer.ts`) は **「PID が OS 上 alive か」だけ判定し、その PID が subscribe プロセスかを検証しない**。前 subscribe が SIGKILL / OOM kill で死に、OS が同 PID を別プロセス (shell / editor 等) に再割り当てした場合:

- `isProcessAlive(stale_pid) === true` (= 無関係プロセスが alive)
- 新 subscribe が永久に lock を奪取できない (= false-positive lock 競合)

## 背景

- macOS / Linux で PID は 16-bit (一部 32-bit) で再利用が比較的頻繁に起きる
- 長時間稼働 host で PID 再利用 → false-positive lock → 自セッションの subscribe が再起動できない症状

## 修正方針

`DR-0007` の `lookupSidProcess` 方式を lock 側に転用:

- subscribe 起動時に **PID + lstart (= プロセス開始時刻) + argv 一部** を `subscribers` テーブルに記録
- lock holder の alive 判定で、PID が alive かつ **同じ lstart / argv pattern (= bun ... cmux-msg subscribe) を持つか**を検証
- 不一致なら stale 扱いで奪取

SQLite schema 変更:

```sql
ALTER TABLE subscribers ADD COLUMN lock_lstart INTEGER;
ALTER TABLE subscribers ADD COLUMN lock_proc_signature TEXT;
```

`ps -o pid=,lstart=,command= -p <pid>` または `/proc/<pid>/stat` から取得。

## 受け入れ条件

- [ ] PID 再利用 simulation で stale lock が奪取できる
- [ ] 同名プロセス (= 自分の subscribe) の場合は奪取しない (= 二重起動防止維持)
- [ ] schema migration が SCHEMA_VERSION bump で適用される
- [ ] 既存 test 全 pass + 新 test 追加
