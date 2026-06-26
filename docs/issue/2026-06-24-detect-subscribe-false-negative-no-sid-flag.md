---
title: detectSubscribeForSid が --session-id / --resume なしで起動された claude で false negative
status: open
category: bug
created: 2026-06-24T17:59:33+09:00
last_read: 2026-06-26T23:56:27+09:00
open_entered: 2026-06-24T17:59:33+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: 自リポ TODO
---

# detectSubscribeForSid が --session-id / --resume なしで起動された claude で false negative

## 概要

claude を `claude "<prompt>"` 形式 (引数に sid フラグなし) で起動した場合、`detectSubscribeForSid` (src/lib/subscribe-watch.ts) が常に false を返す。これにより:

- `check-subscribe` が exit 1 (= subscribe 不在) になる。実際は subscribe が走っていても誤検知
- v0.30.13 で UserPromptSubmit hook に追加した subscribe 補完警告が毎ターン誤発火
- SessionStart hook の "running" 文言判定も誤動作する可能性

## 背景

`src/lib/session-proc.ts::lookupSidProcess` の照合条件:

> argv に `--session-id` または `--resume` フラグがあり、その直後トークンが対象 UUID

これは spawn 経路 (= 明示的に sid 採番) を前提にした実装。ユーザが直接 `claude "プロンプト"` と打って起動した場合、claude プロセスの argv に sid フラグは現れない。session_id は env `CMUXMSG_SESSION_ID` 経由で渡されている。

### 再現手順

```bash
# terminal で
claude "適当なプロンプト"
# 別 shell で
cmux-msg whoami          # → sid 出る (env 経由)
cmux-msg check-subscribe # → exit 1 + stderr 警告 (実際は subscribe 走ってても)
```

ps を見ると:
```
3608  3607 claude 適当なプロンプト       ← argv に sid 無し
84240 3608 ... cmux-msg subscribe       ← 子孫として subscribe 走ってる
```

`lookupSidProcess(sid)` は 3608 を「sid と紐付く claude」として認識できない → detectSubscribeForSid は kind != "found" で early return false。

### v0.30.13 で新規露出した問題

v0.30.13 で UserPromptSubmit に subscribe 検出を入れたため、この bug の影響範囲が「check-subscribe を叩いた時」から「毎ターン」に拡大。早めの対処が望ましい。

### 対策案

1. **env 経由 fallback**: CMUXMSG_SESSION_ID env が sid と一致する claude プロセスを ps から探す (要 `ps eww` or `/proc/<pid>/environ` だが macOS は後者なし)
2. **SessionStart 時に claude pid を meta.json に保存** → 後続 lookup でその pid から子孫を辿る (DR-0007 の resume 耐性検討対象)
3. **PPID chain 経由**: cmux-msg subcommand の親 zsh の親 ... と辿って `command =~ /\bclaude\b/` を見つける (脆弱だが mac/linux 両方で動く)

中規模の設計判断 (= どこで claude pid を握るか) を伴うので DR が要る。本 issue は再現確認まで、設計判断は別途。

## 受け入れ条件

- [ ] `claude "プロンプト"` 形式で起動しても `check-subscribe` が subscribe 有無を正しく返す
- [ ] UserPromptSubmit の subscribe 補完警告が誤発火しない

## 関連

- DR-0007 (resume 耐性ある session 同定)
- src/lib/session-proc.ts::lookupSidProcess
- src/lib/subscribe-watch.ts::detectSubscribeForSid
- v0.30.13 / 2026-06-24 検証セッションで発見
