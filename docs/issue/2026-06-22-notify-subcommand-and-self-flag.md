---
title: notify subcommand と --self flag の追加
status: open
category: design
created: 2026-06-22T22:35:59+09:00
last_read:
open_entered: 2026-06-22T22:35:59+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: cache-warden
---

# notify subcommand と --self flag の追加

## 概要

cmux-msg に **軽量通知 subcommand `notify`** と **`--self` flag** を追加し、subscribe 経路の活用範囲を「セッション間メッセージング」から「自セッションへの非同期指示 (= dogfood)」に広げる。

## 背景

cache-warden で発生した実例 (2026-06-22 セッション):

- justfile `push` task 末尾で `@echo "[hint] gh-monitor:watch-workflow --sha ... --on-success release.yml 'just on-success-release' OWNER/REPO"` を echo
- AI (= Claude Code セッション) が hint を読み飛ばし、SHA-pinned だけで watch-workflow を起動 → `--on-success` 引数が抜け、release.yml success 時の brew upgrade 自動連携が起きない
- 今回は release 非対象 commit で露呈せず済んだが、**echo 経路は AI の手抜き / 引数アレンジを物理的に止められない設計バグ**

= 「echo + AI に正しく読ませる」は仕組みとして脆い。cmux-msg subscribe は AI が能動的に拾う既存経路 (= subscribe 起動済みなら必ず届く)、これを「自分への指示通知」に流用すれば echo 見逃しを物理的に潰せる。

## 仕様提案

### `notify` subcommand

軽量通知。subscribe payload に **本文を直接埋め込み**、受信側は `read` 不要で即実行できる。

```
cmux-msg notify [--to <sid|repo>] [--self] --msg "<text>"
```

- 既存 `send` との違い: `send` は通知に from/to/meta のみ、本文は `read` で取る (= 2 段階、重厚)。`notify` は通知 payload に msg 本文を載せる (= 1 段階、軽量)
- 用途想定: push 完了通知、quick alert、self 向け非同期指示
- msg サイズ: 軽量前提だが上限は実装判断 (= md ぶら下げ用途も想定するか)

### `--self` flag

`send` / `notify` 両方に追加。to == from (= 自 sid) の syntactic sugar。

```
cmux-msg notify --self --msg "Monitor で 'just watch' を起動して"
cmux-msg send --self --label review-done --file report.md
```

### subscribe 通知 payload

`notify` の場合、subscribe stream の JSON に msg 本文を含める:

```json
{"type": "notify", "from": "<sid-A>", "to": "<sid-A>", "msg": "Monitor で 'just watch' を起動して"}
```

`send` の既存 payload は変更なし (= from/to/meta だけ、本文取得は read のまま)。

## 利用イメージ (= cache-warden justfile)

```make
push: ci ...
    bump-semver vcs push --jj-bookmark-auto-advance
    cmux-msg notify --self --msg "Monitor で 'just watch' を起動して"

watch:
    bash <gh-monitor-script> --sha $(...) --on-success release.yml 'just on-success-release' OWNER/REPO
```

AI rule (= 1 文):
> cmux-msg notify で "Monitor で `just <task>` を起動して" が届いたら、その task 名そのまま Monitor で起動する。

= AI は task 名コピペで Monitor 起動するだけ、引数組立 / hint 解釈 / アレンジ余地ゼロ。

## 設計検討ポイント

1. **notify の msg サイズ上限**: 短文限定 (= 1KB 等) vs md ぶら下げ可能。重厚化させない原則を守る範囲
2. **subscribe 落ちてる時の fallback**: notify は fail-and-forget 前提か、後追い read で拾える経路を持つか
3. **既存 send への --self 追加**: notify 単独に留めず send にも入れる方が API 一貫
4. **AI による "自分への notify" の echo chamber 警戒**: AI が notify を loop 送信する pattern を rule で抑制必要かも (= 既存の echo chamber 警戒の延長)
5. **payload type 識別**: subscribe 側で `send` 通知と `notify` 通知を区別する `type` フィールド要

## 関連

- cache-warden DR-0022 検証セッション (2026-06-22) で発覚したフローバグが直接の動機
- 各 kawaz/* repo の justfile canonical (= bump-semver) に同 pattern を統一する波及効果あり

## 受け入れ条件

- [ ] `notify --self --msg <text>` が subscribe stream に `type: notify` + msg 本文を含む JSON を流す
- [ ] `send --self` が to == from の sugar として動作する
- [ ] subscribe 側が `send` と `notify` の payload を type フィールドで区別できる
- [ ] msg サイズ上限の設計判断が DR に記録されている
