---
title: セッション途中の `/cd` で subscribe が落ちる問題
status: open
category: bug
created: 2026-06-18T00:00:00+09:00
last_read: 2026-06-23T08:24:22+09:00
open_entered: 2026-06-18T00:00:00+09:00
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

# セッション途中の `/cd` で subscribe が落ちる問題

## 現象

セッション途中で Claude Code の `/cd` (cwd 変更) を実行した後、subscribe (Monitor 起動の `cmux-msg subscribe`) が落ちて新着通知に気付けなくなる。最近 FleetView を活用するようになってから多発するようになった。

実害:
- subscribe 落ち → ターン中に新着メッセージへ能動反応できない (補完経路の UserPromptSubmit hook は次ターンの送信時にしか発火しない)
- SessionStart hook は `/cd` では発火しないため、AI 側で落ちたことに気付くタイミングが無い

## 仮説 (要実機検証)

### A. `/cd` は SessionStart hook を発火しない

`/cd` は session を resume/restart しないため `SessionStart` hook が発火しない。`subscribe-watch` の `detectSubscribeForSid` ↔ `decideSubscribeMessage` は SessionStart hook 内でしか走らないので、`/cd` 後に subscribe が死んでいても **検知タイミング自体が無い**。

→ 対処方向: 別の hook (例: `UserPromptSubmit`) でも生存チェックを走らせる / 専用の cwd 変更検知経路を作る。

### B. `/cd` で claude プロセスツリーが再構成される

`/cd` 実行時、claude 内部で shell/PTY が再構成され、Monitor 起動の subscribe の ppid が claude 直系から外れる可能性。

ケース 1 (誤検知): subscribe は生きてるが、子孫判定 (`collectDescendantPids`) で見つけられず "落ちた" と誤判定。
ケース 2 (本当に死ぬ): subscribe の親 (Monitor 経由の中間プロセス) が `/cd` で kill され、subscribe が SIGHUP で道連れに死ぬ。

→ 対処方向 (ケース 1): 子孫判定だけでなく command pattern + sid env / lockfile 等で広く検出。
→ 対処方向 (ケース 2): subscribe を nohup / setsid で claude プロセスから decouple できないか検討。

### C. FleetView 経路の暗黙 resume

FleetView から既存セッションを切替える時、内部的に `claude --resume <session-id>` 相当が走るが、SessionStart hook の `source` 判定が `startup` 扱いになる等の漏れがある可能性。

→ 対処方向: FleetView 経由の起動時に source がどう渡るかを確認。

## 検証方法

```bash
# 1. テスト用 session で subscribe 起動
cmux-msg subscribe &
ps -axww -o pid,ppid,pgid,command | grep -E 'claude|subscribe' > before.txt

# 2. /cd で別ディレクトリへ
# 3. 再度 ps tree
ps -axww -o pid,ppid,pgid,command | grep -E 'claude|subscribe' > after.txt
diff before.txt after.txt

# 4. FleetView から別 session に切替 → 戻る
# 5. ps tree 再取得 → 差分確認

# 6. SessionStart hook が発火するか (= ~/.claude-personal/projects/.../*.jsonl に痕跡)
```

## 関連

- `src/lib/subscribe-watch.ts` — `detectSubscribeForSid` / `decideSubscribeMessage`
- `src/hooks/session-start.ts` — subscribe 状態文言の出力ポイント (= 唯一の検知タイミング)
- DR-0007 決定10 — subscribe 検出ロジックの根拠

## 次アクション

1. 仮説 A/B/C を実機マトリクスで切り分け
2. (A) 確定なら hook 拡張 (例: UserPromptSubmit 側でも生存チェック)
3. (B) 確定なら subscribe 起動方式の見直し (setsid 等)
4. (C) は FleetView 内部挙動の調査が要るので最後
