# Decision Records (DR)

設計や実装の重要判断とその理由を時系列で記録する。番号は採番順 (`DR-NNNN`、4 桁ゼロパディング)。

各 DR は accepted のまま残し、覆る判断があった場合は新 DR を立てて旧 DR を `Superseded by DR-NNNN` で紐付ける（古い DR は消さない）。

## 一覧

| ID | Title | Status | Date |
|---|---|---|---|
| [DR-0001](DR-0001-session-id-identifier.md) | 識別子を claude session UUID に一本化 | Accepted | 2026-04-23 |
| [DR-0002](DR-0002-sandbox-and-peer-listing.md) | 子CC サンドボックス境界と peer 列挙の整理 | Accepted | 2026-05-07 |
| [DR-0003](DR-0003-cross-workspace-messaging.md) | workspace 横断のメッセージング (peerDir 2 段解決) | Superseded by DR-0004 | 2026-05-11 |
| [DR-0004](DR-0004-session-as-primary-key.md) | メッセージングの主体を session_id 一意に整理 (sid-unique inbox / meta 拡張 / state トラッキング) | Accepted | 2026-05-12 |
| [DR-0005](DR-0005-claude-home-default-wall.md) | claude_home 壁を実装に落とす (デフォルト軸 = home、cross-home warning) | Accepted | 2026-05-12 |
| [DR-0006](DR-0006-fg-detection-claude-pid.md) | fg 判定の対象 pid を CMUX_CLAUDE_PID に切り替える (shell_pid → claude_pid) | Superseded by DR-0007 | 2026-05-17 |
| [DR-0007](DR-0007-resume-resilient-session-identity.md) | resume 耐性のあるセッション同定 (tty を不変の鍵にした tell 安全境界) | Accepted | 2026-05-17 |
| [DR-0008](DR-0008-messaging-needs-only-session-id.md) | cmux 依存境界の分離 (messaging は session_id のみ、surface 操作のみ cmux 必須) | Superseded by DR-0010 | 2026-06-12 |
| [DR-0009](DR-0009-hyoui-delegation.md) | surface 操作系 (tell / screen / spawn / stop) を hyoui に委譲 | Accepted | 2026-06-16 |
| [DR-0010](DR-0010-drop-cmux-environment-requirement.md) | cmux 環境必須を全廃 (requireCmux / workspace_id / by-surface lookup 削除) | Accepted | 2026-06-16 |
| [DR-0011](DR-0011-drop-tell-command.md) | tell コマンド廃止 + tell-guard 全削除 (中途半端に古いものを残さない) | Accepted | 2026-06-16 |
| [DR-0012](DR-0012-event-driven-subscribe.md) | subscribe を file system イベント駆動 + watermark + ln atomic 排他に切替 | Accepted | 2026-06-16 |
| [DR-0013](DR-0013-rename-to-ccmsg.md) | パッケージ / コマンド / env の cmux- prefix を ccmsg に統一 | Accepted | 2026-06-16 |
| [DR-0014](DR-0014-stdin-body-standardization.md) | send / reply / broadcast の本文入力を stdin に統一 | Accepted | 2026-06-16 |
| [DR-0015](DR-0015-persistent-cwd-mailbox.md) | 永続宛先 (cwd / ws / repo / label) の inbox を sid 宛と並列に持つ (sid 揮発性への対応) | Accepted | 2026-06-16 |
| [DR-0016](DR-0016-status-store-sqlite.md) | session status / 軸索引 / queue 状態を SQLite に集約 (メッセージ本体は file のまま) | Accepted | 2026-06-16 |
