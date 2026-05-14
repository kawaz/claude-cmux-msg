# `cmux-msg tell` が AI 経由 Bash サブプロセスからの self-tell を拒否する

## 現象

claude code セッション内で AI (Claude) が Bash ツール経由で
`cmux-msg tell <self_sid> "/reload-plugins"` を実行すると、

```
session <sid> は foreground にないため tell を拒否しました
  (別 sid のプロセスに誤入力する事故を避けるため)。
  代替: cmux-msg send <sid> "..." で inbox に永続配送できます。
```

で reject される。`<self_sid>` は実際に foreground pane で動いている自分の
セッションそのものを指している。

## 原因

`src/commands/tell.ts` の fg 判定は `ps -o stat= -p <pid>` の `+` フラグを
見ているが、AI が Bash ツール経由で起動した Bash サブプロセスは:

```
PID 98808 STAT=Ss   ← + フラグなし = bg 扱い
```

になる。claude code 自体 (cmux pane の foreground プロセス) は `+` を持つが、
Bash ツールで spawn された子プロセスは別 process group で `+` を引き継がない。

## 影響

AI が自分のセッションに `/reload-plugins` などのスラッシュコマンドを
self-tell して反映させる経路が成立しない。`cmux-msg send` で inbox には
届くが、`tell` の同期発火経路 (idle 時即時実行) は使えない。

## 想定ユースケース

- AI が plugin install / update した直後に `/reload-plugins` を自己発火させ、
  現セッションで新 hook を反映する
- AI 主導での状態遷移 (compact 後の再 init など) を self-tell で表現する

リモートクライアントから claude code を操作するケースでは、ユーザが
ターミナル直打ちで tell を発火することもできない (ローカル mac 側に
シェルが無い)。AI 経由が唯一の自動化経路になる。

## 提案

候補:

1. **self-tell 特例** — `sender_sid == target_sid` のとき fg 判定を skip
   (自分が自分に投げるのは「別 sid 誤入力」のリスクなし)
2. **fg 判定の遡上** — `ps -o stat= -p $(ps -o ppid= -p ...)` のように
   親プロセスへ遡って `+` フラグを探す (最も近い claude code parent まで)
3. **controlling tty の fg pgrp** — `ps -o tpgid,pgid,stat -p <pid>` で
   tpgid == pgid を見て fg pgrp 帰属を判定 (Bash サブプロセスでも親 pgrp
   が fg なら true 判定)

セキュリティ境界 (「別 sid のプロセスに誤入力する事故を避ける」) は
ターゲット sid と現実の fg session の matching が本質なので、self-tell 特例
(候補 1) が最小工数で安全に思える。

## 関連

- `docs/decisions/DR-0004-session-as-primary-key.md` §7「fg/bg 判定は動的に
  問い合わせる」
- 元発見セッション: kawaz/claude-rules-personal の plugin install 動作確認
  時 (2026-05-14)
