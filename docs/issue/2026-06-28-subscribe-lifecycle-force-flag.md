---
title: Monitor 経由 subscribe のライフサイクル管理 UX 改善
status: open
category: request
created: 2026-06-28T15:27:13+09:00
last_read:
open_entered: 2026-06-28T15:27:13+09:00
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

# Monitor 経由 subscribe のライフサイクル管理 UX 改善

## 概要

ユーザ / AI が subscribe を Monitor 経由で起動する際、**自 sid の前 subscribe を kill してから再起動する経路がない**。前 subscribe が alive だと `tryAcquireLock` の per-sid 二重起動防止が発火し exit 1 になる (= 設計通り)。

## 背景

### 想定シナリオ

- AI が "subscribe 張り直し" と判断したが、前回 Monitor で起動した subscribe を kill 忘れた / Monitor の TaskStop が来てない
- `/reload-plugins` 後の subscribe 再起動 (plugin update 経路)
- subscribe が hang したように見えて手動再起動を試みる場合

### 現状

- error message に `kill <lock_pid>` を含めて利用者誘導 (本セッションで実装済み)
- ただし AI / ユーザは Bash で `kill` してから Monitor 再起動の **2 ステップ** を踏む必要あり

## 改善案

選択肢:

1. **`subscribe --force`** (or `--takeover`): 既存 lock を SIGTERM で kill → grace 待ち → 自 PID で奪取
2. **`subscribe --replace`**: alive な前 holder を見つけたら一旦待ち、grace 内に解放されなければ kill して奪取
3. **`cmux-msg restart-subscribe` 別 subcommand**: 1/2 を意図明示で expose

選択肢 1 が最もシンプル。AI 向け SKILL.md でも "張り直したい時は --force" と書ける。

## 受け入れ条件

- [ ] `subscribe --force` で前 subscribe を kill → 新 subscribe が lock 奪取できる
- [ ] SIGTERM → 5s grace → SIGKILL の段階的 kill
- [ ] grace 内に自然終了すれば SIGKILL は不要
- [ ] AI 向け SKILL.md に "張り直し時は --force" を記載

## 関連

- `2026-06-27-subscribe-lock-cross-session-contention` (archive) の "利用者が遭遇した真の課題" の本筋がこちら
- `2026-06-28-subscribe-lock-pid-reuse-false-positive` (PID 再利用対策)
