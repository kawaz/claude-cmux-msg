---
title: プロセス情報を構造化 JSON で取得するツール / 機能
status: open
category: request
created: 2026-05-17T00:00:00+09:00
last_read:
open_entered: 2026-05-17T00:00:00+09:00
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

# プロセス情報を構造化 JSON で取得するツール / 機能

fg 判定 (DR-0006 周辺) で「sid → claude プロセスの PID・状態」を引くために
`ps -axww` のコマンドライン照合を使う方針になった。この「プロセス情報取得」を
より堅牢・再利用可能な形に切り出せないか検討する。

## 背景

fg 判定は対象 sid を `ps -axww -o pid,stat,command` で `--session-id <uuid>`
照合し、PID と `STAT` (fg=`+` / suspended=`T` / bg) を得る方針。

`ps` ベースの課題:
- macOS の `ps` は argv を切り詰めることがある (取得元 `KERN_PROCARGS2` の
  サイズ制約)。`--session-id <uuid>` は claude の前方引数なので実用上は
  通るが、保証はない
- `STAT` のフラグ表記は macOS と Linux で細部が異なる (`+` `T` は共通だが
  他フラグは差がある)
- 出力がテキストでパースが脆い

## 提案

pid を指定するとパースしやすい構造化 JSON
(pid / ppid / pgid / tpgid / stat / fg-bool / argv 配列 / 起動時刻 等) を
返す単機能ツール、または cmux-msg 内の lib として実装する。

- macOS なら `sysctl KERN_PROCARGS2` / `libproc` (`proc_pidinfo`) で argv と
  プロセス情報を切り詰めなしで確実に取得できる
- `kawaz/authsock-warden` で既にプロセス情報を詳細取得する実装をしている。
  その資産を再利用、または共通の単機能ツールとして切り出すと両プロジェクトで
  使い回せる

## 検討点

- cmux-msg 内の lib に閉じるか、独立ツール (kawaz/* の新リポ) にするか
- authsock-warden の実装をライブラリ化して両者が depend する形が自然か
- 当面は mac 対応優先でよい (kawaz の環境が mac)
- cmux-msg 側は「sid → プロセス情報」を 1 関数に閉じ込めておけば、
  実装を `ps` → ネイティブツールへ後から差し替え可能

## 関連

- fg 判定方式 (DR-0006 周辺、2026-05-17)
- `kawaz/authsock-warden` (プロセス情報詳細取得の既存実装)

報告者: kawaz (2026-05-17、fg 判定バグ調査セッション内)。別 issue として起票。
