# 2026-05-18 DR-0007 (resume 耐性のあるセッション同定) 設計議論〜実装

`tell` の fg 判定バグの修正から始まり、設計議論の深化で fg 判定方式の
全面再設計に至り、DR-0006 を DR-0007 で supersede して実装まで通した記録。
テスト 181→344 pass、v0.28.2 を push。

## 経緯

### 発端: fg 判定バグの応急修正 (DR-0006 / v0.28.1)

`cmux-msg tell` の fg 判定が、fg pane に居る claude セッションへの self-tell を
誤って reject するバグがあった。`process.ppid` 起点の `shell_pid` 判定が、
シェルの exec 最適化に依存した脆い前提だったのが原因 (詳細は
`2026-05-17-fg-detection-fix.md`)。一旦 DR-0006 で `CMUX_CLAUDE_PID` env を
起点にした `claude_pid` 固定記録方式に修正し、v0.28.1 を push した。

これは「応急修正」だった。後述の通り、設計議論を深めると DR-0006 の方式自体に
複数の欠陥が見つかり、DR-0007 で全面的に作り直すことになる。

## ハマり所 → 解決策

### ハマり所 1: spawn signal タイムアウトバグの誤った真因認定

spawn した子 CC からの signal が 30 秒でタイムアウトする現象を調査した。
当初「シェルの遅延起動が真因」と結論を出したが、ユーザ指摘で再検証することに
なった。

→ クリーンに再現させて再調査したところ、真因は別だった。**子 CC の
SessionStart hook が `cmux-msg-bin` 不在時に同期ビルド (~90 秒) を実行し、
親の 30 秒 signal 待ちを超過していた**。「シェル遅延起動」は的外れだった。

**教訓**: トラストプロンプトに人が介入した状態で観察すると、その介入時間が
混入して検証が汚れる。真因を追うときはクリーンに (人の介入なしで) 再現させて
から計測すること。最初の調査はこれを怠ったため誤った結論を出した。

### ハマり所 2: DR-0006 方式の欠陥が次々と判明

設計議論を深める中で、DR-0006 の `claude_pid` 固定記録方式に複数の欠陥が
見つかった:

- **`CMUX_CLAUDE_PID` は spawn 子に無い**。cmux は自分が起動した claude にのみ
  この env を渡す。spawn は pane のシェルへ `claude` コマンドを送る方式なので
  env が設定されない。
- **pid 固定記録は resume で陳腐化する**。claude は cmux/OS 更新やクラッシュで
  終了し、別 pid で再開される。
- **surface↔sid は 1対n、かつ sid は surface/workspace を移動する**。これは
  DR-0004 line 22 に既出の事実 (「surface→sid の逆引きは時間依存」) だった。
  pid に対して「固定記録を真実源にしない」とした論理は、`surface_ref` 固定
  記録にもそのまま当てはまる。
- **`+` フラグ (STAT の foreground) は controlling tty 非依存**。別 surface
  (別 tty) の claude も各々 `+` を持つので、`+` 単独では「tell 先 surface の
  前面が対象 claude」を保証しない。

→ fg 判定方式の全面再設計が必要と判断。DR-0006 を DR-0007 で supersede する
ことにした。

### ハマり所 3: レビュー指摘をそのまま採用しかけた

設計案に対しマルチペルソナ full-review を 2 回、codex レビューを 2 回かけた。
レビューは多くの指摘・改善案を出すが、それらを鵜呑みにして反映しかけた。

→ ユーザから重要な指摘があった: **レビュー指摘も改善案も、レビュアーの知識
ベースに基づく「仮説」にすぎない**。実機実験でエビデンスを取ってから採用/
非採用を判断すべき。さらに **再レビュー時にはエビデンス検証結果を添える**と、
反証済みの指摘を蒸し返されずに済む。

この方針で実機検証を行い、エビデンスを `docs/findings/` に残した。検証で
分かった主な事実:

- 全 claude プロセスが argv に `--session-id <UUID>` を持つ (cmux 起動・spawn
  経由問わず)。`ps -axww` のコマンドライン照合で sid→PID が一意に引ける。
- `ps -axww` は argv を切り詰めない (1545 文字を完全出力)。argv 切り詰め懸念は
  反証された。
- `+` ⟺ `PGID == TPGID`。
- claude は 1 プロセス = 1 controlling tty。cmux surface も固有 tty を持つ。
  claude の controlling tty を鍵に surface を逆引きできる。
- subscribe (Monitor 起動) は親 claude の子孫プロセスツリーに居る (double-fork
  懸念は反証)。

### ハマり所 4: 何を「不変の鍵」にするか

pid も surface_ref も移動・陳腐化するなら、何を tell の安全判定の基礎に
据えるか。

→ **設計の核心: tty を claude と surface を結ぶ不変の鍵にする**。claude
プロセスの controlling tty (pty) は、プロセスが生きている限り不変。cmux が
surface を別 pane / 別 workspace に動かしても pty は維持される。よって:

```
sid → ps 照合で claude プロセス → claude の controlling tty (ps -o tty)
    → その tty を抱える cmux surface (cmux に動的逆引き)
```

このチェーンで送り先 surface を毎回動的に決める。`meta.json` の
`surface_ref` 固定記録は送り先解決に使わない (参考情報に降格)。tty から
claude と surface の両方を引くので「送り先 surface == 対象 claude の居る
surface」が定義上保証され、別途の突合照合が不要になる。

## 実装

設計確定後、7 タスクに分解し各々 TDD で実装した:

1. `bin` 廃止 — SessionStart hook の同期ビルド (ハマり所 1) を断つため、
   コンパイル済み `cmux-msg-bin` への依存をやめ bun 実行に一本化
2. `src/lib/` の基盤関数 — 「sid → プロセス情報」を引く新関数、claude の
   tty → cmux surface を逆引きする新関数 (`stat` パースは関数内で正規化)
3. `tell` 作り直し — 安全境界を tty 動的逆引き + fg 判定 (`pgid==tpgid`) +
   send 直前再照合に置換、拒否理由コードを区別、`--ignore-cross-home` 追加
4. `screen` 作り直し — 同じく tty 逆引き方式へ。`state` は問わない
5. `last_observed_pid` — `claude_pid` を改名し `(pid, start_time)` ペア構造に。
   連続性検出専用、tell 判定には使わない。更新は `transitionState()` に統合
6. subscribe 検出 — SessionStart hook が「自分の claude PID の子孫ツリーに
   subscribe が居るか」を確認し source 別文言を出す
7. 拒否ログ — `tell`/`screen` の拒否イベント (時刻・sid・理由コード・pid) を
   記録し、`ambiguous_*` / `check_failed` の発生頻度を後から追えるように

テストは 181 → 344 pass まで増えた。`just ci` を通し v0.28.2 を push。

## 学び

- **「動いている」が「正しい」とは限らない**: DR-0006 は応急修正としては
  動いたが、設計議論を深めると前提 (`CMUX_CLAUDE_PID` の存在、pid/surface_ref
  の固定記録) が次々崩れた。動作確認だけで満足せず前提を疑うこと。
- **誤った真因認定はクリーンな再現で防ぐ**: spawn タイムアウトの初期調査は、
  人の介入時間が混入した汚れた観察から「シェル遅延起動」と誤断定した。
  検証はクリーンに再現させてから。
- **レビュー指摘は仮説、エビデンスで裏を取る**: full-review / codex の指摘も
  改善案もレビュアーの知識ベース由来の仮説。実機実験でエビデンスを取って
  から採用/非採用を決める。再レビューにはエビデンスを添えて反証済み指摘の
  蒸し返しを防ぐ (ユーザからの重要な指摘)。
- **「固定記録を真実源にしない」論理は横展開する**: pid を固定記録しないと
  決めたなら、同じく移動する `surface_ref` も固定記録を真実源にしてはいけない。
  片方だけ直すと設計が中途半端になる。
- **不変な鍵を探す**: pid も surface も移動・陳腐化する中で、tty (claude の
  controlling pty) はプロセスが生きる限り不変という性質を見つけたことが
  再設計の決め手になった。
