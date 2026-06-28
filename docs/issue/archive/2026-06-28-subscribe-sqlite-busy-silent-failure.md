---
title: subscribe.ts の SQLITE_BUSY 握り潰し silent failure を解消
status: resolved
category: bug
created: 2026-06-28T15:24:18+09:00
last_read:
open_entered: 2026-06-28T15:24:18+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered: 2026-06-28T15:44:35+09:00
discard_reason:
pending_reason:
close_reason: ["implemented","v0.30.18 で subscribe.ts に isSqliteBusyError() 判定を追加、SQLITE_BUSY 系は exit 1 で安全側停止"]
blocked_by:
origin: claude-cmux-msg
---

# subscribe.ts の SQLITE_BUSY 握り潰し silent failure を解消

## 概要

`src/commands/subscribe.ts:205-216` の catch block が `tryAcquireLock` の SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT を握り潰して `[warning] subscribe DB lock skipped` に流し、**lock 未取得の状態で subscribe を継続**する。これにより同一 sid の二重起動が事実上許可される silent failure 経路ができる。

## 観測

- 実機計測 (workflow 調査) で 20 並行 × 10 runs のうち **12.2% で throw** → catch block で warning に落ちる
- catch block は `db = null` にして lock-free モードで継続するが、これは「DB 未初期化 / sessions row 不在 (= 旧来環境)」のための fallback であり、SQLITE_BUSY はそこに該当しない
- 結果: lock を持っていない subscribe が emit を行い、本来の lock holder と同時に同じメッセージを stdout に流す → AI 側で二重処理リスク

## 関連 issue

- `2026-06-28-begin-immediate-transaction` で BEGIN IMMEDIATE 化すると throw 頻度は 0% に近づくが、それでも本問題は「何かの原因で throw された場合」の安全側挙動として直す価値がある (= defense in depth)

## 修正方針

catch block の動作を分岐:

1. **DB 初期化失敗 / sessions row 不在** (= 旧来環境): 従来通り warning + lock なしで継続 (= 後方互換)
2. **SQLITE_BUSY 系**: lock 取得できなかった = 既存 holder が居る可能性 → exit 1 で停止 (= silent failure 防止)
3. **その他 SQL エラー**: 同上、exit 1

エラー判定は `e.message` / `e.code` を使う。`bun:sqlite` の `SQLiteError` 型を見て分類。

## 受け入れ条件

- [ ] BEGIN IMMEDIATE 化前提でも、人為的に SQLITE_BUSY を発生させた場合に exit 1 する
- [ ] 旧来環境 (sessions row 不在) では従来通り lock なしで継続 + warning
- [ ] 既存 test が全 pass
- [ ] subscribe.test.ts に「SQLITE_BUSY 時は exit 1」のテスト追加
