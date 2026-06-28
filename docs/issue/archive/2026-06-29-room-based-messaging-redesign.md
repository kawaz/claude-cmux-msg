---
title: room-based messaging への再設計検討 (p2p から room layer + reaction へ)
status: discarded
category: design
created: 2026-06-29T04:05:19+09:00
last_read:
open_entered: 2026-06-29T04:05:19+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered: 2026-06-29T09:11:02+09:00
resolved_entered:
discard_reason: ["discarded:v1途中送信、本論点はroom-based-messaging-v2-proposalで継続"]
pending_reason:
close_reason:
blocked_by:
origin: claude-cmux-msg
---

# room-based messaging への再設計検討 (p2p から room layer + reaction へ)

## 概要

kawaz 主導の 3 セッション (die / grapheme.mbt / timespec.mbt) dogfood で抽出された 5 つの構造的問題に対して、**room-based messaging への再設計**を die セッションから提案。詳細は die からの送付メッセージ (= accepted/20260629T040232-42dbd079.md)。本 issue は議論追跡の入口。

## 5 つの観察 (= kawaz 抽出)

1. **クロス爆発**: 1 対 1 通信しかないので、N peer 増えると組合せ爆発
2. **同一指示の負担**: kawaz が複数 peer に同じ依頼 → AI 双方が同じ行動 → 受け手の負担
3. **AI 間の無駄会話**: '相手はああ言ってた' 系の伝聞が peer 間で増殖
4. **メール調社交辞令の肥大化**: msg / send の語感が長文メール調を誘発、最初の褒め合いで context 浪費
5. **kawaz の AI 混入コスト**: 1 対 1 経路だと kawaz が複数 AI に同時発信できずコピペ発生

## 提案 core: room layer + reaction syntax

- room_id: 'r-XXXXXXXX' (参加 sid 等を hash 化、冪等)
- member seq id: room 内 short ID (0=kawaz 予約、1, 2, ...)
- mid: room 内追記順
- 新 sub-commands (案): `post {room, to?, msg}` / `react {room, mid, emoji}` / `read {room, up_to_mid}`
- subscribe payload に **room 全文展開** で配信 (= 受信側 read 1 hop 削減)
- kawaz は room の member 0 として参加、CLI / UI で 1 post で全員に配信

5 問題のうち (1)(2)(3)(4) は構造的解決、(5) は kawaz UI 設計の宿題。

## 検討すべき論点 (= 早まらないため、room 案に飛びつく前の対比)

### A. room layer 採用判断

- **整合性**: 既存 `broadcast --by` (DR-0015) との重複 / 拡張関係。room は label の augment or 置換?
- **dual mode 期間**: p2p (send/reply) と room を並走させる期間、最終的に p2p 廃止するかの方針
- **storage layout 変更**: `<base>/<sid>/inbox/` ベースから room 単位 dir (`<base>/rooms/<r-id>/...`) への移行
- **breaking change の規模**: DR-0019 級または以上 (= minor or major bump)

### B. 既存機能で代替できないか

- **broadcast --by 強化**: 5 問題のうち (1)(2) は同一指示の broadcast で多くカバー可能?
- **threading 強化**: in_reply_to の連鎖を強化して 'スレッド単位 read' を提供すれば AI 無駄会話 (3) は減らせる?
- **CLI syntax 縮約**: `react` / `read` を独立 sub-command にせず `reply --emoji 👍` / `accept --silent` で代用?
- 観点: design-priority の '正しい設計' vs '既存延長' のトレードオフ

### C. kawaz UI 設計

- kawaz は AI session ではないので subscribe path がない
- TUI / web UI / say 連携 / 既存 cmux-msg CLI 拡張のいずれか
- これが設計されないと room layer 単体では (5) 問題解決にならない

### D. room ID 安定化

- 参加 sid + repo + ws + cwd の hash で冪等性確保
- メンバー追加 = 新 room (history は引き継がない案、die session) で OK か
- 別案: room を mutable にして history 継続させる (= ID 不安定、conflict 検出複雑)

### E. 命名 / interface-wording

- 'room' vs 'channel' vs 'thread' vs 'group' — どれが本質を最も表す?
- (4) の解決として 'post' / 'react' を採用する場合、cmux-msg / ccmsg のリブランドと同時にやるべきか (= DR-0013 と統合)

## 自評価 (= cmux-msg session の judgement)

### 賛成寄り
- 5 問題は kawaz 主導 dogfood 抽出で信頼度高い
- (4) 'msg/send の語感が社交辞令を誘発' は cmux-msg interface-wording の本質的弱点を突いている
- room layer + reaction syntax で 4/5 問題を構造的に圧縮できる発想は本質的

### 懸念 (echo chamber 警戒)
- die session のバイアス: 8 時間 dogfood 後で具体案に飛びつきがち。既存機能 (broadcast / threading 強化) で代替できないかの比較が薄い
- 規模が DR-0019 級以上で、実装着手前に kawaz の方針確定が必須
- kawaz UI が未確定 = room layer 単体だと (5) は未解決

## 進め方提案

1. **本 issue で議論集約** (= 上記論点 A-E の対比検討)
2. kawaz と直接相談 (= room vs 既存機能強化、UI 設計、breaking 規模)
3. 方針確定したら DR 起票 (= 仮 DR-0020 'room-based messaging' 等)
4. 実装は別 issue で段階 (= post / react / read を個別 PR で land)

cmux-msg session 側で勝手に DR 起票 / 実装着手しない (= 設計の根幹判断は kawaz 必須)。本 issue を kawaz が読んで判断するまで保留。

## 関連

- die session からの提案 message: `<base>/<sid>/accepted/20260629T040232-42dbd079.md` (現セッション内)
- DR-0015: 永続宛先 inbox (room の前段としての label/cwd/repo/ws 軸)
- DR-0017 / DR-0018: notify (room 通知の payload 設計に影響)
- DR-0013: ccmsg rename (interface-wording 議論と統合余地)

## 受け入れ条件

- [ ] kawaz が論点 A-E を読んで方針を判断した
- [ ] room 採用 or 既存機能強化の方針が決定した
- [ ] 方針確定後に DR 起票 or 別 issue への分岐が完了した
