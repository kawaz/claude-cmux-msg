---
title: "Threat model 検討: 同 UID 信頼 vs sid attestation (sid spoofing / priority spoof 対策)"
status: open
category: design
created: 2026-06-28T20:41:00+09:00
last_read: 2026-06-29T09:17:58+09:00
open_entered: 2026-06-28T20:41:00+09:00
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

# Threat model 検討: 同 UID 信頼 vs sid attestation (sid spoofing / priority spoof 対策)

> ⚠️ **room-based-messaging 設計確定後に再評価** (2026-06-29 トリアージ): [room-based-messaging-v2-proposal](./2026-06-29-room-based-messaging-v2-proposal.md) の room layer の member 概念追加で room 内 sid 検証の論点が増える、先に threat model を固めると手戻り risk。room 方針 land まで着手保留 (blocked_by までは付けず判断保留)。

## 概要

攻撃者視点レビューで複数の Critical 級 spoofing 経路を発見した。**現状の threat model (= 同 UID 内の全プロセスを信頼) を維持するか / sid attestation (= 自セッション process tree しか sid を name 出来ない) に強化するか** の設計判断 issue。

## 発見された攻撃ベクトル (Critical)

### 1. `from` / sid spoofing

`src/config.ts:19-25` の `getSessionId()` は env `CLAUDE_CODE_SESSION_ID` / `CMUXMSG_SESSION_ID` を**無条件**に信頼する。同 UID プロセスは以下が可能:

```
CMUXMSG_SESSION_ID=<victim-uuid> cmux-msg send <peer> --text "任意の偽メッセージ"
```

これで:
- 受信側 peer は **victim から来た** と認識する
- victim の inbox / sent / accepted を **読み書き可能** (= `<base>/<sid>/` は UNIX perm のみで守られる)

### 2. priority spoof

`src/lib/sender.ts:64` の `process.env.CMUXMSG_PRIORITY` 経由で全 send を urgent 化可能。受信側の AI が urgent を「直ちに対応すべき」と扱う運用なら、攻撃者は victim を装って優先度詐称する。

### 3. subscribe hijack via SIGKILL

`src/lib/subscriber-state.ts:106-119` の `isPidAlive` は SIGKILL で殺された後の dead PID を「dead」と判定する。攻撃者が victim の subscribe を SIGKILL → spawn 直後に `canAcquire=true` で奪取できる。lstart 検証は PID 再利用検出に効くが**意図的な kill+spawn には効かない**。subscribe 奪取 = victim 宛の notify を全部攻撃者が受信 + label 等の書き換え可能。

## 検討すべき threat model

### Option A: 現状維持 (同 UID 信頼)

- メリット: simple、low overhead
- デメリット: 上記 spoofing が成立する。ただし攻撃者は既に同 UID プロセスを動かせる時点で他の経路 (= ~/.ssh 読み書き、curl 任意サイト) でも被害可能なので、cmux-msg だけ守っても意味薄
- 整合性: Unix の標準モデル

### Option B: sid attestation

- env から sid を取った後、`lookupSidProcess(sid).pid` が自プロセスの ppid chain 上にあることを検証
- 偽装 env を入れても、claude プロセスの子孫でなければ拒否
- メリット: spoof 不能
- デメリット: 実装複雑、ps 呼出 cost、cross-process spawn 経路 (= justfile script からの cmux-msg 呼出 等) で false negative の risk

### Option C: 部分的緩和

- frontmatter injection は別 issue で escape 済み (= 完了)
- priority spoof: env `CMUXMSG_PRIORITY` 廃止、CLI `--urgent` flag のみに
- subscribe hijack: warning メッセージ追加 + lockfile + UNIX perm を tighten

## 推奨判断 (= AI 意見、kawaz の判断待ち)

**Option A + C 一部**: 個人プロジェクトで「同 UID 信頼」を threat model として明示し、priority spoof だけ env 廃止 + CLI flag 化で簡素に対応。Option B (sid attestation) は実装複雑 vs 実害低 (= 攻撃者は同 UID で他経路でも害可能) で見合わない。

## 受け入れ条件

- [ ] threat model を docs (README / DESIGN) に明示
- [ ] CMUXMSG_PRIORITY env 廃止 (Option C 採用時) + `--urgent` flag 追加
- [ ] subscribe hijack の警告を docs に追記

## 関連

- 攻撃者視点レビュー (本 issue 起票のきっかけ)
- 別 issue で対応済み: frontmatter injection (cmux-msg v0.31.4 で escape 追加)
