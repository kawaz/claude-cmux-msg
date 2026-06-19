---
title: cmux への atomic 送信 API 要望 (foreground pgrp 条件付きキー入力)
status: discarded
category: request
created: 2026-05-18T00:00:00+09:00
last_read:
open_entered: 2026-05-18T00:00:00+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered: 2026-06-19T10:00:00+09:00
resolved_entered:
discard_reason: ["dr/DR-0011"]
pending_reason:
close_reason:
blocked_by:
origin: 自リポ TODO
---

# cmux への atomic 送信 API 要望 (foreground pgrp 条件付きキー入力)

`cmux-msg tell` の TOCTOU 窓を根本的に閉じるための、cmux 本体への機能要望。

報告者: kawaz (2026-05-18)。DR-0007 決定6 / 未解決節で「別 issue 起票する」と
約束した要望の起票。本 issue は cmux 本体への要望であり、cmux-msg 側からは
着手対象外。

## 背景

`cmux-msg tell` は対象セッションの cmux surface (ターミナルペイン) へ
キー入力を注入する操作。誤った相手に注入すると、別 claude への誤指示や
シェルへの危険コマンド流し込みが起きる。

DR-0007 はこの安全性を「sid → `ps` 照合で claude プロセス特定 → claude の
controlling tty → cmux surface を動的逆引き → fg 判定 (`pgid==tpgid`) →
send 直前に pid 指定で再照合」というチェーンで高めた。

しかし**照合と実際の send の間の TOCTOU 窓は構造的にゼロにできない**。`tell`
がキー入力注入である以上、再照合をどれだけ精密にしても、照合通過から
`cmuxSend`+`Return` までの時間窓は残る。

最悪ケース: 再照合通過の直後に対象 claude が Ctrl-Z され、同 surface の
シェルが前面に出た瞬間に `<text>` がシェルコマンドとして実行される。DR-0007
決定5 の「改行を含まない 1 行のみ」制約により被害は最悪でも 1 コマンドの
誤実行に限定されるが、窓そのものは消せない。

## 要望

cmux に **「対象 surface の foreground process group が pid X のときだけ
paste / キー入力する」atomic な送信 API** があれば、TOCTOU 窓を根本的に
閉じられる。

- cmux 側でキー入力の注入直前に「surface の fg pgrp == 指定 pid」を確認し、
  一致するときのみ注入、不一致なら no-op で失敗を返す
- 確認と注入が cmux 内部で atomic に行われるため、cmux-msg 側の照合〜send の
  間に対象が Ctrl-Z / 終了 / 入れ替わりしても、危険コマンドがシェルに流れる
  ことがなくなる

## cmux-msg 側の想定

この API が cmux に入れば、cmux-msg 側は `tell` の送信時に対象 claude の
pid を cmux に渡せるようにする。DR-0007 のチェーンで claude の pid は既に
確定しているため、それを送信 API の引数に乗せるだけで済む想定。

## 関連

- `docs/decisions/DR-0007-resume-resilient-session-identity.md` 決定6
  (TOCTOU 残存リスクと緩和) / 未解決節
- `docs/journal/2026-05-18-dr-0007-design-and-impl.md`
