---
title: cmux-msg spawn sub-command の削除
status: resolved
category: request
created: 2026-06-23T08:24:18+09:00
last_read: 2026-06-28T19:32:31+09:00
open_entered: 2026-06-23T08:24:18+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered: 2026-06-28T19:53:50+09:00
discard_reason:
pending_reason:
close_reason: ["implemented:v0.31.0 + DR-0019 で cmux 連携機能を完全除去 (spawn/tell/screen/stop + lib/cmux* + CMUX_* env + by-surface lookup + meta フィールド)、cmux-msg は pure messaging plugin に純化"]
blocked_by:
origin: 自リポ TODO
---

# cmux-msg spawn sub-command の削除

## 概要

`cmux-msg spawn` sub-command を削除する。kawaz からの削除指示。

## 背景

kawaz から「spawn まだ残ってるの?」の指摘。削除指示。

詳細 (= なぜ削除するか、移行先、影響範囲、廃止手順) は kawaz が本 issue を読んだ時に追記予定。本起票は **削除フラグの設置のみ**。

## 該当 sub-command

`cmux-msg spawn <name> [--cwd path] [--args claude-args] [--tags csv]`

子 CC を起動して inbox 初期化する機能。

## スコープ

- 含む: spawn sub-command の削除 + 関連 doc / completion / test の同期
- 含まない: 移行ガイド・代替経路の判断 (= kawaz 追記待ち)

## 一次資料

- bin/cmux-msg 内の spawn 実装
- SKILL.md / docs/DESIGN.md / docs/STRUCTURE.md の spawn 言及箇所

## 受け入れ条件

- [ ] spawn sub-command が削除されている
- [ ] 関連 doc / completion / test が同期されている
