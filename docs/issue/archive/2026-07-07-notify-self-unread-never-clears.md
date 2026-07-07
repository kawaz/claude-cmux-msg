---
title: notify --self のメッセージが read しても未読のまま残り続ける
status: resolved
category: bug
created: 2026-07-07T21:23:51+09:00
last_read:
open_entered: 2026-07-07T21:23:51+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered: 2026-07-07T21:37:34+09:00
discard_reason:
pending_reason:
close_reason: ["implemented: list (type=notify除外) と UserPromptSubmit/countInbox の未読カウント (type=notify除外) を修正し実装で解決。実機確認済み (notify --self 送信後、list に出ない/未読カウントに含まれない、read で本文は引き続き読める)"]
blocked_by:
origin: kawaz/kuu
---

# notify --self のメッセージが read しても未読のまま残り続ける

## 概要

plugin v0.31.7 で観測 (2026-07-07)。push task の
`cmux-msg notify --self --text "Monitor で 'just watch' を起動して"` で
自分宛て通知を送った後、`cmux-msg read <filename>` は exit 0 で本文を
正しく出力するにもかかわらず:

1. `cmux-msg list` に同メッセージが出続ける
2. UserPromptSubmit hook の未読カウント (「未読 N 件」) が減らない

複数回 read しても変化なし。2 通で再現 (どちらも from = to = 同一セッション
ID の `notify --self` 由来)。

## 背景

利用側は kawaz/kuu (spec リポ) の push-workflow で、push task 末尾の
`cmux-msg notify --self` を canonical 経路として使っている
(= `[[push-workflow]]` rule、`kawaz/bump-semver` の justfile v0.43.0+ 実装参照)。
notify --self は push のたびに毎回発火するため、本 issue の発生頻度は高い。

実害: 毎ターン hook が「未読あり」ノイズを出し続け、AI が繰り返し read を
試みる無駄が生じる。

### 観測の一次資料

- セッション ID: `ed0029a5-e6d1-4ac1-9ccb-f99948e52b2e`
- メッセージ実例: `20260707T130843-30c4be48.md`, `20260707T212032-1ab4278e.md`
- どちらも `from == to` (= notify --self による送信者・受信者の縮退ケース)

## 仮説 (裏取りは当事者側で)

- send / recv 縮退ケース (= `--self` で `from == to`) で既読 index の
  更新パスが効いていない可能性
- または `list` / 未読カウントの実装が「自分が送信したメッセージ」を
  常に未読扱いし続けている可能性

**未検証**: peer からの通常メッセージ (from != to) で同事象が再現するか
どうかは確認していない。部外者観測のため、この切り分けを含めて当事者側で
実機検証してほしい。

## 受け入れ条件

- [ ] `notify --self` → `read` 後に `list` / 未読カウントが正しく減ることを確認
- [ ] from == to (self 縮退) ケースと通常 peer ケースの両方でマトリクス検証
- [ ] 根治 (または既に仕様通りなら「仕様」である旨をこの issue に追記して close)
