# セッション同定・fg 判定の実機検証エビデンス

DR-0007 (resume 耐性のあるセッション同定) の設計判断を支える実機検証の記録。
マルチペルソナ full-review / codex レビューで出た指摘を、実機検証で採用/反証/
未確定に振り分ける。再レビュー時にこのレポートを添えることで、反証済みの指摘の
蒸し返しを防ぐ。

## 判明した事実 (実機検証で確定)

検証環境: macOS (darwin 25.3.0)、cmux ターミナル、複数 Claude Code セッション同時稼働。

1. **全 claude プロセスが argv に `--session-id <UUID>` を持つ**。cmux 起動・spawn
   経由を問わず。実機で同時稼働の 6 プロセス全てで確認。argv 形式は
   `claude --settings {…JSON…} --session-id <uuid> --dangerously-skip-permissions`。
2. **`ps -axww` は argv を切り詰めない**。`--settings` の JSON 込みで argv 1545
   文字を完全出力。全 claude で `--session-id` も末尾フラグ
   `--dangerously-skip-permissions` も取得できた。argv 長は cmux の hook 設定
   JSON が固定なので 1545 で頭打ち (可変要素なし)。
3. **`+` (STAT フラグ) ⟺ `PGID == TPGID`**。実機で `S+` の claude は全て
   `PGID==TPGID`、Ctrl-Z 済みの `T` の claude のみ `PGID≠TPGID`。`+` は
   「pgid が controlling tty の foreground process group と一致」の表示。
4. **claude は 1 プロセス = 1 controlling tty**。実機で 6 claude が各々別 tty
   (ttys000/003/006/008/010/011)。複数の claude が同時に `S+` (各自の tty で
   foreground)。→ `+` 単独は「システム内で一意に foreground」を意味しない。
5. **cmux surface は固有の tty を持つ**。`cmux tree` の出力に `tty=ttysNNN`。
   claude の controlling tty (`ps -o tty`) と surface の tty を突合できる。
6. **Monitor 起動の `subscribe` プロセスは親 claude の子孫プロセスツリーに居る**。
   実機で `claude(24792) → zsh -c(31181) → cmux-msg-bin subscribe(31183)`。
   親 claude が死ぬと PPID=1 へ reparent される (実機で別セッションの死亡分が
   PPID=1 だった)。「親 claude 生存中は子孫ツリーに居る」が成立。
7. **bg/fg 検出 hook は Claude Code に存在しない**。公式ドキュメント
   (code.claude.com/docs) で hook イベント全 8 種を確認、suspend/resume・
   foreground/background 遷移で発火するものは無い。fg/bg を通知する API・
   環境変数・状態ファイルも無い。
8. **`+` ⟺ `pgid==tpgid` は pid 指定照会でも取れる**。`ps -p <pid> -o
   pgid,tpgid,tty,stat` で特定 pid のプロセスグループ情報が引ける (argv を
   パースせずに済む)。

## 未確定 (検証が不十分なまま)

- **`claude --resume <uuid>` の実 argv**。`--resume` のまま出るのか
  `--session-id` に正規化されるのか。cmux pane を連続生成する実験環境が不安定で
  3 回試行して直接捕捉できなかった。照合パターンを `(--session-id|--resume)`
  両対応にすれば、どちらでも取りこぼさないため設計はブロックしない。
- **`T+` (foreground process group のまま stopped)** の実在。ジョブ制御の
  Ctrl-Z ではシェルが claude を background pgrp 化するため `+` が外れる
  (実機の Ctrl-Z 済み claude は `T` のみ、`+` 無し)。claude は SIGTSTP を 2 回
  必要とする (1 回目は `S+` のまま) ので中間状態 `T+` も生じにくい。理論上の
  排他でない可能性は残るため、防御的に `T` を独立判定する方針は維持。

## full-review 指摘 → 実機検証結果

初期マルチペルソナ full-review (5 ペルソナ) の主要指摘の検証結果。

| # | 指摘 | 検証結果 | 判定 |
|---|---|---|---|
| 2 | `+` は controlling tty 非依存で、別 surface の claude を fg 誤判定する | 事実1〜5 で裏付け。複数 claude が別 tty で同時 `S+`。**ただし** 各 claude は固有 tty を持ち surface も固有 tty なので、claude の tty と surface の tty を突合すれば「その surface に対象 claude が居て fg」を判定できる | **採用** (対策 = tty 一致照合、実現可能と実証) |
| 5 | macOS の `ps` で argv 切り詰めが起き `--session-id` が落ちる | 事実2 で**反証**。`ps -axww` が 1545 文字を完全出力。argv 長は固定で頭打ち | **反証** (当面 `ps -axww` で問題なし) |
| - | subscribe の子孫照合は double-fork による reparent で false negative になる | 事実6 で**反証**。subscribe は親 claude の子孫ツリーに正常に存在。reparent は親 claude 死亡後のみ | **反証** (子孫照合は機能する) |
| 3 | `STAT` の `+`/`T` は排他でなく `T+` がありうる | 未確定 (上記)。実機の Ctrl-Z 済み claude は `T` のみ | **部分採用** (防御的に `T` を独立判定) |
| 4 | ppid 遡りは exec 最適化依存で不安定 (DR-0006 が論証済み) | hook が自分の sid を知っている事実 (hook input JSON) + 事実1 より、ppid 遡りに頼らず sid で照合できる | **採用** (ppid 遡り不要) |
| 1 | TOCTOU: 照合と send の間の窓で状態変化 → 誤 tell | 窓の存在は論理的に自明。実測しても「ゼロにできない」結論は不変 | **採用** (send 直前再照合で最小化、残存リスク明記) |
| - | `ps` 失敗時の fail-open/closed 未定義 | 設計判断の欠落 (検証対象でなく設計で埋める) | **採用** (fail-closed) |
| - | tell 許可条件に `state=idle` が欠落 (DR-0004 §7 と不整合) | 設計の抜け | **採用** |

## codex 指摘 → 実機検証結果

codex (改訂版 DR-0007 レビュー、ただしエビデンス未添付) の指摘:

> `ps -o command` は argv 境界を保持しない表示文字列。空白を含む 1 引数の中に
> `--session-id <UUID>` が現れると、フラグでなくても「直後トークン」と誤認しうる。

検証:

- 事実1 より、正規の claude の argv は
  `claude --settings {固定JSON} --session-id <uuid> --dangerously-skip-permissions`
  に固定。`--settings` の JSON は cmux の hook 設定 (`cmux hooks claude …` 等) で、
  **`--session-id` という文字列を値の中に含まない**。
- したがって正規運用の claude では、`ps command` 表示文字列上で `--session-id`
  はフラグとしてのみ現れ、誤認は起きない。
- 誤認が成立するのは「引数値の中に `--session-id <別sidのUUID>` という文字列を
  含む claude」が存在する場合。これは正規の cmux/spawn 起動では生じず、ユーザが
  手動で異常な引数を与えた場合に限る。
- **判定**: 指摘は表示文字列パースの一般論として正しいが、エビデンス上「正規
  運用では誤認は起きない」。設計の堅牢化として「`--session-id <uuid>` の照合
  ヒット数が 1 であること」を確実性の担保に使い、**2 件以上ヒットしたら判断
  不能エラーとして fail-closed + ログ記録 + ユーザ確認を促す** 形にすれば、
  万一の誤認・並行 resume の双方を曖昧状態として安全に弾ける。commandline 照合
  方式そのものを捨てる必要はない。

## 実用的な示唆 (DR-0007 へのフィードバック)

1. fg 判定は「対象 claude の tty == tell 先 surface の tty」かつ
   「`pgid==tpgid`」で行う (`+` 単独でなく)。
2. sid→pid は `ps` の `--session-id <uuid>` 照合で引く。**ヒット数 1 を確実性の
   担保とし、0 件=不在 / 2 件以上=判断不能 (fail-closed + ログ + ユーザ確認)**。
3. argv 切り詰め・subscribe double-fork は反証済み。設計を重くしない。
4. `T` は独立判定。`ps` 失敗・曖昧は全て fail-closed。
5. TOCTOU 窓は send 直前再照合で最小化、残存は明記。

## 関連

- DR-0007: 本レポートが支える設計判断
- DR-0006: DR-0007 が supersede
- DR-0004 §7: tell の安全境界
