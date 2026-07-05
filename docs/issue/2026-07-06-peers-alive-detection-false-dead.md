---
title: peers の alive 判定が実際に生きているセッションを dead 表示する疑い (broadcast --by repo が届かない実害)
status: open
category: bug
created: 2026-07-06T08:22:52+09:00
last_read:
open_entered: 2026-07-06T08:22:52+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: hyoui (cross-project flag, no reciprocal action needed)
---

# peers の alive 判定が実際に生きているセッションを dead 表示する疑い (broadcast --by repo が届かない実害)

## 概要

部外者 (hyoui リポでの作業セッション) からの観測フラグ。断定はしていない。裏取りしてから採否を判断してほしい。

## 背景

2026-07-03、hyoui repo で 2 セッション並行作業中 (cmux-msg v0.31.7) に以下を観測した:

1. `cmux-msg peers` が自 session (8442a619-...) を「dead state=running (self)」と表示した (dead なのに state=running という矛盾表示)
2. 直前まで send/reply で双方向通信できていた相手 session (a7761122-...) が alive 一覧に出ず、「dead 3566件 非表示」側に含まれていた。相手は subscribe を Monitor で稼働中と自己申告

### 実害

`cmux-msg broadcast --by repo` が「broadcast 対象なし (条件: repo)」を返し、実際には生きている同 repo peer にメッセージが届かなかった (後に直接 send では届いた = peer 自体は生存)。

### 相手セッションの見立て (伝聞)

「peers で dead に見えるのは cmux 登録の staleness」とのこと。

### 部外者としての推測 (未検証、裏取り前提)

alive 判定がプロセス検出ベースなら、`hyoui run --detached` 経由で起動された claude セッション (プロセスツリーが daemon 化で切れる) の検出に失敗する可能性がある? 観測した 2 セッションはいずれも hyoui 配下で起動されたもの。ただしこれは未検証の仮説で、該当コードは読んでいない。

## 依頼

alive 判定ロジックと登録更新 (staleness) の仕組みを当事者側で確認し、採否を判断してほしい。再現は「hyoui run --detached 経由の claude 2 セッションで cmux-msg peers」。

## 受け入れ条件

- [ ] alive/dead 判定ロジックの実装箇所を特定
- [ ] 上記観測 (自 session の dead+running 矛盾表示、生存中 peer の dead 誤判定) の再現有無を確認
- [ ] 再現するなら根本原因を特定し、修正方針 (or 意図的挙動である旨) を記録
- [ ] 再現しない/該当なしなら、その根拠とともに close
