---
title: src/lib/ flat 構造をサブディレクトリ化 (subscribe/ + session/)
status: open
category: request
created: 2026-06-28T20:36:05+09:00
last_read: 2026-06-29T09:16:49+09:00
open_entered: 2026-06-28T20:36:05+09:00
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

# src/lib/ flat 構造をサブディレクトリ化 (subscribe/ + session/)

## 概要

`src/lib/` に 30+ ファイルが flat に並んでおり、subscribe / session-lifecycle / message-store の責務軸が見えにくい。建築家視点レビューで指摘。

## 提案分割

### `src/lib/subscribe/` への移動候補

- subscribe.ts (= diffInbox / decideNotify)
- subscribe-watch.ts (= detectSubscribeForSid + decideSubscribeMessage)
- subscriber-state.ts (= subscribers テーブル、tryAcquireLock)
- pid-signature.ts (= PID 再利用 false-positive 対策)
- force-takeover.ts (= subscribe --force 用)
- sqlite-error.ts (= SQLITE_BUSY 判定、subscribe.ts で使用)
- begin-immediate-concurrency.test.ts (= subscribe lock 並行 test)

### `src/lib/session/` への移動候補

- session-proc.ts (= ps による sid → process 照合)
- session-status.ts (= sessions / labels テーブル)
- claude-ancestor.ts (= ppid chain で claude root 探索)
- state.ts (= meta.json 経由の state トラッキング)
- transition.ts (= accept / dismiss / reply の状態遷移)
- state-hook.ts (= 状態遷移系 hook の共通ロジック)
- scope-hash.ts (= cwd / ws / repo の正規化 + hash)

### 残留 (`src/lib/` 直下)

- inbox.ts / sender.ts / frontmatter.ts / meta.ts / paths.ts (= messaging core)
- peer.ts / peer-filter.ts (= peer 列挙)
- db.ts (= 全 lib 横断の SQL 共通基盤)
- validate.ts / errors.ts / format.ts / argv.ts / label-parser.ts (= utility)
- history.ts / layout-docs.ts / repo-root.ts / message-queue.ts / ensure-path.ts (= ヘルパ)

## メリット

- 責務軸が明示化 (subscribe vs session vs core messaging)
- 新規開発者の認知負荷削減
- import 文で論理境界が見えるので「逆方向 import」(= subscribe が session を呼ぶ vs 逆) のチェックが容易に
- 単体 test 配置の方針も自動的に決まる

## デメリット / リスク

- import path 大量変更 (= 1 PR が大きい diff)
- 既存 test との path conflict 注意
- 移動先 dir 内でも複数ファイルが密結合状態のまま (= dir 分割しただけで本質的なモジュール境界改善になるか要検討)

## 受け入れ条件

- [ ] subscribe/ + session/ 分割が land
- [ ] 既存 test 全 pass
- [ ] import path 更新が漏れなく完了

## 関連

- 建築家レビュー (本 issue 起票のきっかけ)
- DR-0016 (subscribe + session の lib 構造を再整理する起点)
