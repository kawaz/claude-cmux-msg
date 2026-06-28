# Issue INDEX

active な issue の一覧。close 済みは `archive/` にあり、ここには載せない。

| date | category | status | slug | 概要 |
|---|---|---|---|---|
| 2026-06-28 | bug | open | [subscribe-lock-pid-reuse-false-positive](./2026-06-28-subscribe-lock-pid-reuse-false-positive.md) | subscribe lock の PID 再利用 false-positive 対策 |
| 2026-06-28 | bug | open | [subscribe-sqlite-busy-silent-failure](./2026-06-28-subscribe-sqlite-busy-silent-failure.md) | subscribe.ts の SQLITE_BUSY 握り潰し silent failure を解消 |
| 2026-06-28 | bug | open | [begin-immediate-transaction](./2026-06-28-begin-immediate-transaction.md) | subscriber-state / message-queue の db.transaction() を BEGIN IMMEDIATE に変更 |
| 2026-06-24 | bug | open | [detect-subscribe-false-negative-no-sid-flag](./2026-06-24-detect-subscribe-false-negative-no-sid-flag.md) | detectSubscribeForSid が --session-id / --resume なしで起動された claude で false negative |
| 2026-06-23 | request | open | [cmux-msg-spawn-subcommand-deletion](./2026-06-23-cmux-msg-spawn-subcommand-deletion.md) | cmux-msg spawn sub-command の削除 |
| 2026-05-27 | request | open | [observation-via-csa-timeline](./2026-05-27-observation-via-csa-timeline.md) | child の内部活動観測手段として csa timeline cursor 経路を SKILL.md に追記 |
| 2026-05-17 | request | open | [process-info-tool](./2026-05-17-process-info-tool.md) | sid→プロセス情報の構造化 JSON 取得を単機能ツール / lib に切り出す |
| 2026-05-09 | idea | idea | [discuss-jsonl-monitoring-loop](./2026-05-09-discuss-jsonl-monitoring-loop.md) | Claude Code jsonl tail-f 監視ループをどこに置くかの議論起点 |
