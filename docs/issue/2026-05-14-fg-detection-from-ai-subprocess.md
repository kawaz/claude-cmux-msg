# `cmux-msg tell` の fg 判定バグ — fg にいるのに「foreground にない」と reject

## 現象

claude code セッションが cmux pane の **foreground にある状態で**、AI が
Bash ツール経由で `cmux-msg tell <self_sid> "/reload-plugins"` を実行すると:

```
session <sid> は foreground にないため tell を拒否しました
  (別 sid のプロセスに誤入力する事故を避けるため)。
```

で reject される。`<self_sid>` は実際に foreground pane で動いている
セッションそのものを指している (= 本来 tell が通るべきケース)。

## 原因

`src/commands/tell.ts` の fg 判定は `ps -o stat= -p <pid>` の `+` フラグを
見ている。しかし、AI の Bash ツール経由で起動した Bash サブプロセスは:

```
PID 98808 STAT=Ss   ← + フラグなし
```

になり、判定ロジックは「fg にない」と結論する。

これは判定の見方の問題で、実際には:

- claude code 本体プロセス (cmux pane の親) は fg pgrp に属し `+` を持つ
- Bash サブプロセス (claude の `bash -c` 実行) は controlling tty 取り回し
  や process group 分離の関係で `+` を持たないことがある

「判定対象 PID」を Bash サブプロセスにしてしまうと正しく拾えない。

## 影響

AI が自分のセッションに `/reload-plugins` 等のスラッシュコマンドを
self-tell して反映させる経路が成立しない。`cmux-msg send` で inbox には
届くが、`tell` の同期発火経路 (idle 時即時実行) は使えない。

リモートクライアントから claude code を操作するケースでは、ユーザが
ローカル mac 側でターミナル直打ちで tell を発火することもできないため、
AI 経由が唯一の自動化経路。そこが塞がる。

## 想定される修正方針

判定ロジックを「Bash サブプロセスの `+` を見る」から、現実の fg 帰属を
正しく取れる方式に変える。たとえば:

- session_id から特定される claude プロセス側を見る (Bash サブプロセスを
  経由しない)
- `ps -o tpgid,pgid -p <pid>` で controlling tty の fg pgrp との一致を見る
  (祖先プロセスまで遡れば fg は判定可能)
- 既存ロジックを残しつつ、Bash 環境変数等から claude code session pid を
  別途解決して、そちらを判定対象にする

セキュリティ境界 (「別 sid のプロセスに誤入力する事故を避ける」) は
**ターゲット sid が実際の fg session と一致するか** の問題なので、
sender 側の pid フラグを見る現在の実装は本来やりたい判定とずれている。

## 関連

- `docs/decisions/DR-0004-session-as-primary-key.md` §7「fg/bg 判定は動的に
  問い合わせる」
- 発見セッション: kawaz/claude-rules-personal の plugin install 動作確認時
  (2026-05-14)
