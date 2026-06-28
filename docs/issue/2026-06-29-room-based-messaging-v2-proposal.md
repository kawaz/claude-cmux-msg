---
title: room-based messaging v2 提案 受領記録 (die セッションから)
status: idea
category: design
created: 2026-06-29T04:36:32+09:00
last_read:
open_entered:
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: die セッション (cmux-msg message 20260629T043026-4712cc83.md)
---

# room-based messaging v2 提案 受領記録 (die セッションから)

## 概要

die セッションから room-based messaging 再設計 (v2) 提案を受領。p2p send の上に room layer を被せ、JSONL append-only model + member seq ID + mid で 5 つの構造的問題 (クロス爆発 / 同一指示の負担 / AI 間無駄会話 / メール調肥大化 / kawaz 混入コスト) を解決するという提案。

受領元: cmux-msg message `20260629T043026-4712cc83.md`。reply 不要指示あり。
本 issue は受領記録 + 論点整理のみ。設計判断は後続セッションで kawaz と相談して実施。

## 提案 core

- p2p send は当面残し、複数セッション議論は room へ寄せる
- 各 room = 1 JSONL ファイル、各行が 1 event (member / msg / move)
- room ID: `r-XXXXXXXX` (uuid 系、member set hash である必要なし)
- member seq ID: room 内 1,2,3... (0 は kawaz 予約)
- message ID (mid): room 内追記順
- 自分送信は echo back されない
- 必須コマンドは `post` / `create_room` のみ、reaction / read marker は不要 (短文文化を SKILL で肯定)

## 残課題 (後続セッションで判断)

1. kawaz 参加 UI 経路 (say / TUI / web UI / cmux-msg CLI 拡張)
2. 既存 p2p send との使い分け判断軸 (SKILL 明示)
3. 自分宛以外メッセージの閲覧 UI
4. DR / SKILL.md / 通知 UI の追従範囲

## 既存 issue / DR との突合

- 9 件 active issue + 関連 DR (DR-0004 / DR-0010 / DR-0013 等) と論点重複/競合の可能性あり
- 方向性が大きく変わるので既存 issue のトリアージが必要になる可能性 (= 不要化判定対象)

## 進め方 (本 issue では未決)

- DR 化するか / SKILL 改訂単独で済むか
- p2p 廃止 vs 共存
- room 内 member 増減の冪等性

## 受信元

受領メッセージ全文は cmux-msg archive の `20260629T043026-4712cc83.md` 参照。

## 受け入れ条件

- [ ] kawaz と相談して設計方針確定 (DR 化 or SKILL 改訂単独)
- [ ] 既存 issue / DR とのトリアージ完了
- [ ] 具体的な実装計画が立案済み (後続 issue or DR に昇格)
