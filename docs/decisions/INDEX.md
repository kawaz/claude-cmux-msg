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
