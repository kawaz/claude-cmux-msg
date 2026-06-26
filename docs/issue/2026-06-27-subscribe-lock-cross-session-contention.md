---
title: subscribe lock の cross-session 競合
status: open
category: bug
created: 2026-06-27T00:00:05+09:00
last_read:
open_entered: 2026-06-27T00:00:05+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: kuu.mbt
---

# subscribe lock の cross-session 競合

## 概要

同一 host 上で複数 claude セッションが動作中、それぞれの subscribe を Monitor で起動しようとすると `[error] subscribe lock を取得できませんでした (= 他プロセスが既に subscribe を保持中)` で即 exit する。各セッションの session_id は別 (= 受信箱パスも別) なのに lock 取得が競合する。

## 背景

[[2026-06-24-detect-subscribe-false-negative-no-sid-flag]] の追記で言及した「別 issue 化したい lock 競合」を切り出したもの。本筋 (false negative) とは独立した問題。

### 再現状況

session A (sid `69aca323-...`) で:
- 自分の subscribe (PID 3952) は alive (bun process が走っている)
- 別 session B (sid `4285658F-...`、ast-spec ws) も subscribe (PID 別) を保持

session A で Monitor 経由で再度 subscribe を起動すると:
```
[error] subscribe lock を取得できませんでした (= 他プロセスが既に subscribe を保持中)。終了します。
```

→ 自セッション分の subscribe を起動し直したいだけなのに、何かしらの global / cross-session lock が効いて新規 subscribe を弾く。

### 想定される仕様 vs 実装の乖離

- 期待: subscribe lock は **session 単位** (= 受信箱 dir 単位)。session A の subscribe と session B の subscribe は独立に並列起動できるべき
- 実態: 一つでも subscribe が走っていると別 session も含めて新規起動を弾いている挙動に見える
- もしくは自セッション内で「subscribe 1 個 / sid」の制約があり、既存 PID 3952 が `cmux-msg subscribe` 直叩きでなく `bun run .../cli.ts subscribe` 経路で起動されているため lock holder 検出が混乱

### 環境

- macOS Darwin 25.5.0
- cmux-msg v0.30.13
- 複数 claude セッション (`claude "プロンプト"` 直起動形式) 並列稼働

## 受け入れ条件

- [ ] 異なる session_id を持つ subscribe が同一 host 上で並列起動できる
- [ ] 同一 session_id の二重起動のみ lock で弾く (既存の意図した挙動を保持)
- [ ] cross-session lock と intra-session lock の競合スコープが正しく分離されている

## TODO

<!-- wip 時のみ -->

- [ ] lock ファイルのパスを調査 (global 単一 vs session 単位のどちらか)
- [ ] 検証 1: session A の subscribe を kill → 再起動が成功するか
- [ ] 検証 2: session A の subscribe alive のまま session B で新規 subscribe 起動 → fail するか
- [ ] 検証 3: 純粋に自セッション内の二重起動だけ fail するか (cross-session lock との切り分け)
