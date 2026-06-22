---
title: check-subscribe subcommand を追加し subscribe 落ちを recipe fail で強制気付かせる
status: resolved
category: design
created: 2026-06-22T23:42:23+09:00
last_read: 2026-06-23T00:00:00+09:00
open_entered: 2026-06-22T23:42:23+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered: 2026-06-23T08:44:15+09:00
discard_reason:
pending_reason:
close_reason: ["implemented","v0.30.13 で check-subscribe subcommand 実装完了。exit code 0=動作中, 1=不在 (Monitor 起動コマンドを stderr 出力), 2=sid 解決失敗。decideCheckSubscribe を純粋関数として切り出してテスト可。"]
blocked_by: subscribe-drop-on-cd-and-fleetview
origin: 自リポ TODO (notify 議論の派生、2026-06-22 セッション)
---

# check-subscribe subcommand を追加し subscribe 落ちを recipe fail で強制気付かせる

## 概要

cmux-msg に **`check-subscribe` subcommand** を追加。現セッション (= env から解決した sid) で subscribe が起動中かを判定し、起動してなければ非ゼロ exit + Monitor 経由起動手順を stderr に出す。

justfile / 他の recipe の deps に入れて、**subscribe 落ちを recipe fail で AI に強制気付かせる**。echo hint と違い無視不可。

## 背景

notify-subcommand-and-self-flag (#) の前提として subscribe 動作信頼性が必要。echo hint は AI が見落とすので、recipe レベルの fail で物理的に止める仕組みが要る。

実例 (2026-06-22 cache-warden 議論):
- subscribe が落ちると notify 経由の指示が届かない
- 「subscribe 起動してね」を echo しても AI が無視するリスクは echo hint 問題と同型
- → recipe の deps に `check-subscribe` を入れれば、落ちてる時は `just push` 等が必ず fail する

## 仕様提案

```
cmux-msg check-subscribe
```

- 現セッションの sid を env から解決 (`CLAUDE_CODE_SESSION_ID` / `CMUXMSG_SESSION_ID` / by-surface lookup)
- 既存 `src/lib/subscribe-watch.ts` の `detectSubscribeForSid` を再利用
- exit code:
  - `0`: subscribe 起動中 (= OK)
  - `1`: subscribe 起動なし (= recipe fail させる側)
  - `2`: sid 解決失敗 (= subscribe 無関係セッションかも、warning)
- 起動なしの場合 stderr に **Monitor 経由起動コマンドのコピペ可能な文字列** を出力 (= 引数組立余地ゼロ)

## 利用イメージ

```make
push: check-subscribe ci ...
    bump-semver vcs push --jj-bookmark-auto-advance
    cmux-msg notify --self < hint.txt

check-subscribe:
    cmux-msg check-subscribe
```

= subscribe 落ちてる状態で `just push` 叩くと最初の deps で fail、stderr に「Monitor で `cmux-msg subscribe` を起動して再実行して」が出る。AI は無視できない。

## 設計検討ポイント

1. **subscribe-drop-on-cd-and-fleetview との依存**: 現行 `detectSubscribeForSid` は Claude プロセスツリーから descendant pid を辿る方式。`/cd` 後にプロセスツリーが切れて誤検知する可能性 → 「subscribe 動いてるのに recipe fail」事故。subscribe-drop-on-cd-and-fleetview の検出ロジック強化 (例: `<base>/<sid>/subscribe.pid` 直接読み等) が前提
2. error message の物理ガード性: Monitor 経由起動コマンドを embed しても、AI が `cmux-msg subscribe &` を Bash で叩いて Monitor 経由じゃない起動になる可能性 → これも echo hint と同型の問題。完全物理ガードは難しいが、recipe fail でループ強制までは可能 (= 間違って起動しても次回 push でまた fail)
3. `ensure-subscribe` 案 (= 起動してなければ自動起動) との比較: Bash 起動だと Monitor 経由じゃないので fleetview から見えない問題が残る。**check のみに留めるのが筋**
4. sid 解決失敗時 (exit 2) の扱い: recipe 側で `|| true` で握りつぶすか、fail にするか
5. AI が hook 経由じゃなく claude プロセス外で push する場合 (= cmux 外 / 別 shell): sid 解決失敗で exit 2 → recipe は通る、subscribe チェックはスキップ。妥当か

## 受け入れ条件

- [ ] `cmux-msg check-subscribe` が現セッション sid を env から解決し、subscribe 起動中かを判定
- [ ] exit code: 0 (起動中) / 1 (なし) / 2 (sid 解決失敗) で区別
- [ ] 起動なしの場合 stderr に Monitor 経由起動コマンドの完全な文字列が出力される
- [ ] `subscribe-drop-on-cd-and-fleetview` の検出ロジック強化が前提条件 (blocked_by)
- [ ] テスト: 起動中 / 起動なし / sid 解決失敗 / `/cd` 後の検出精度を実機マトリクス検証

## 関連

- notify-subcommand-and-self-flag: notify 前提として subscribe 信頼性が必要、本 issue がその前提
- subscribe-drop-on-cd-and-fleetview: 検出ロジック強化が本 issue の前提条件 (blocked_by)
- `src/lib/subscribe-watch.ts` `detectSubscribeForSid` / `collectDescendantPids`
- DR-0007 決定10 (subscribe 検出ロジックの根拠)
- echo hint 問題 (cache-warden, 2026-06-22): 物理ガード化のモチベーション
