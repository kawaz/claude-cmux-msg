---
title: 中央デーモン方式アーキテクチャ検討 (rewrite: claude-ccmsg + ccmsg-webui)
status: open
category: design
created: 2026-06-29T10:14:32+09:00
last_read:
open_entered: 2026-06-29T10:14:32+09:00
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

# 中央デーモン方式アーキテクチャ検討 (rewrite: claude-ccmsg + ccmsg-webui)

## 概要

room-based-messaging-v2-proposal で die セッションから受領した room layer 提案を、**既存 cmux-msg リポ内で改修せず、rewrite で別リポに作る**方針が kawaz から提示された (2026-06-29)。中央デーモン方式 + サイドカー subscribe + jsonl room log + bun+hono web API という構成案。

## kawaz 方針 (要点)

### 中央デーモン方式が最も素直

- **書き込みを 1 プロセス (デーモン) に集約**することで競合問題がシンプル化
- 既存の p2p 方式 (UNIX perm + lockfile + PID 検査) で発生する subscribe lock 競合 / sid spoof / SIGKILL hijack 等の threat model が **構造的に消える**

### デーモン起動

- SessionStart / ターンごとの hook で **軽量静寂チェック + 自動起動**
- ユーザは存在を意識せず使える

### サイドカー subscribe

- 各セッションに socket イベントメッセージ待ちループの軽量プロセス (= 旧 cmux-msg subscribe 相当)
- daemon から socket 経由で push される

### データモデル

- **room ログ = jsonl ファイル** (room-based-messaging-v2-proposal の append-only モデルそのまま)
- **既読管理 / メタデータ** = 隣に sqlite (= 1 プロセスで書くなら sqlite で十分)
- room ログと sqlite で「不変イベント」「可変状態」を分離

### CLI / UI

- ユーザ UI となる CLI も同じ daemon チェック + 起動ロジック
- socket に対してメッセージイベント送受信
- = **CLI もデーモンクライアント** (= 3rd party client と同格)

### Web UI 拡張

- daemon に **web API** を持たせる (bun + hono)
- UI 自体は別サブプロジェクト
- socket / web API は **セキュリティ層を挟んで同じプロトコル** にしておく (= 内部利用 / 外部利用で同じ contract)

## リポジトリ戦略: rewrite

**既存 cmux-msg は rename せず、rewrite で別リポを作る**:

- **claude-ccmsg** (plugin + daemon): 中央デーモン本体 + Claude Code plugin
- **ccmsg-webui**: Web UI サブプロジェクト
- 既存 **cmux-msg は p2p 機能のまま安定維持** (rewrite 完成まで dogfood 継続可)
- DR-0013 (cmux-msg → ccmsg rename) は rewrite 戦略下で **不要化** (= 別リポなのでリネーム不要)

## 既存 cmux-msg リポ open issue への影響

cmux-msg リポ内の以下 open issue は **rewrite 戦略下で要否再判断**:

- `branding-consolidation`: rename 不要なら本 issue ごと不要 (= cmux-msg は cmux-msg のまま終わる)
- `error-code-system`: cmux-msg p2p 安定維持なら新規 error code 体系導入は YAGNI 寄り
- `lib-subdir-subscribe-session`: 同上、p2p のままなら大改修は不要
- `threat-model-uid-trust-vs-sid-attestation`: rewrite で central daemon になれば threat model が変わる、cmux-msg 側の対策は最小限で OK
- `release-yml-auto-tag-gh-release`: 既存 cmux-msg にも適用したい標準化、rewrite 戦略と独立 → 残す

## 設計論点 (要詳細化)

### A. プロトコル設計

- socket (unix domain) と web (HTTP) で同じイベント model を流す
- 認証層: socket は file mode 0600 + UID check、web は token / mTLS / オリジン制限?
- メッセージ envelope: `{type, room, from, to?, payload, ts}` 程度

### B. デーモンのライフサイクル

- 起動: SessionStart hook が socket 存在チェック → なければ daemon spawn
- 停止: 最後のクライアント disconnect から N 分 idle で auto-shutdown? or 常駐?
- crash recovery: jsonl room log は append-only なので daemon 再起動で状態復元、sqlite は wal で自然

### C. room 概念のスコープ

- room ID 生成 (uuid / hash / 人間付与)
- メンバーシップの persist (sqlite)
- 既読 cursor の persist (sqlite)
- room 一覧 / 検索 API

### D. CLI 互換性

- 旧 cmux-msg コマンドのうちどれを ccmsg CLI で残すか
- AI agent への subscribe stream は同じ JSONL line-by-line semantics を維持?
- 移行期: cmux-msg と ccmsg を両方インストールするケースの merge view?

### E. 配布 / install

- claude-ccmsg = Claude Code plugin として配布
- ccmsg-webui = bun アプリ単独、daemon が同 host にいれば接続
- daemon binary は plugin に同梱 (bun compile?)

### F. Web UI スコープ (ccmsg-webui)

- kawaz が AI 同士の room に参加するための UI
- 通知 / room 切替 / 既読管理 / 検索
- mobile からの emergency access? (= スコープ外で良いか)

## 受け入れ条件

- [ ] 設計論点 A-F が整理され DR に昇格する準備ができている
- [ ] claude-ccmsg リポ戦略が確定し、既存 cmux-msg open issue の要否が再判断済み

## 関連

- room-based-messaging-v2-proposal.md (= die セッション提案の受領記録、本 issue の出発点)
- DR-0013 (= cmux-msg → ccmsg rename、rewrite 戦略下で不要化候補)
- DR-0004 (= 識別子モデル sid 直接化、rewrite で再評価)

---

## 2026-06-29 codex レビュー結果反映

codex (GPT-5.4) による read-only review を実施 (`codex:codex-rescue`)。重要度順に整理:

### Critical (= 設計前に決定すべき)

1. **single host 前提 vs multi-host を確定**: docs で曖昧。SSH/tmux 越し作業 / mobile を一級要件にするなら設計が分散 messaging に化ける。曖昧なまま web API まで設計すると「ローカル IPC ツール vs 分散」が割れる。**先に決め打ちすべき判断軸**
2. **Daemon supervision の具体化**: 「crash recovery 自然」だけでは不足。OOM / fd leak / zombie sidecar / hot loop / partial write / socket stale file / version mismatch / crash loop が未対処。launchd/systemd or plugin spawn + PID file + health check + exponential backoff + stale socket cleanup + crash counter が必要
3. **Backpressure / queue overflow**: 未記載。遅い subscriber / 巨大 payload / web UI 接続断で詰まる。**設計原則**: per-client ring buffer + drop policy + durable cursor (sqlite) + push は通知のみ・本文は pull、無制限 queue 禁止
4. **Auth boundary**: socket 0600 + UID check は同一 UID 内悪意/誤爆に無力 (= Claude session 間権限分離にならない)。web API は外部露出 risk が別格。**MVP default**: 127.0.0.1 only / web disabled by default / short-lived token / token rotation / CSRF + origin 対策。外部公開を正式サポートするなら別 DR
5. **Migration strategy 未設計**: cmux-msg + ccmsg 並走期間 / merged view / staged deprecation path。**MVP では明示的に別世界**、bridge/import は一方向のみ限定
6. **真の MVP スコープ**: `local daemon + create_room/post/subscribe + jsonl log + sqlite cursor + minimal CLI` まで。**MVP 外**: web UI / mTLS / 検索 / mobile emergency access / merged view。最初から全部入れると 5 問題の検証前に基盤作りで沈む
7. **「p2p threat が構造的に消える」は言い過ぎ**: socket 乗っ取り / daemon impersonation / web API 露出 / token 漏洩 / log 改竄 / 再起動時未 flush に置換される。**正しい言い方**: 「脅威が消える」ではなく「境界が変わる」 → DR で正しく書き直す

### Major (= 設計時に決定すべき)

- **AI-to-AI noise は arch だけで解けない**: room 権限 / mention 必須 / bot-to-bot 自動投稿制限 / rate limit を MVP から (= docs/SKILL.md 依存だけでは制御不能)
- **Web API を daemon 本体に最初から持たせるのは YAGNI**: local IPC contract が固まる前に HTTP contract を固定すると認証/CORS/token が設計を汚す。**HTTP bridge は別プロセス案** (= daemon 内部 API を先に安定化)
- **sidecar 抽象の過剰一般化 risk**: 「Claude session に入力を届ける stream adapter」であって「汎用 subscriber framework」ではない。**MVP は「CLI subscribe コマンドの常駐実装」**、別プロセス抽象を過剰一般化しない
- **room ID 設計**: canonical = random UUID/ULID、display name は別メタ、invite/share token は別概念
- **read cursor key**: `(room_id, principal_id, device_id?)`。MVP は per-principal last_mid、multi-device は後回し
- **jsonl と sqlite の source of truth**: source = jsonl (immutable, append-only)、sqlite = 再生成可能 cache。crash 時再構築可能
- **message envelope 不足**: 現案 `{type, room, from, to?, payload, ts}` に `mid` (daemon 採番) / `seq` / `causality` / `schema_version` / `client_msg_id` (retry idempotency) を追加
- **bun + hono の選定検証**: daemon としては Node/Deno/Go より crash 特性 / single binary 配布 / sqlite-WAL/UDS 周りを検証すべき。**Go は daemon 安定性で強い、bun は開発速度で強い**。trade-off を DR で明示
- **echo back と self_notify の分離**: `sender_echo=false` と `self_notify=true` は別フラグ (旧 `notify --self` 互換のため)
- **monorepo を MVP は推奨**: API 激変期は repo 分割摩擦。**webui は後置でも OK** (= `claude-ccmsg` monorepo + `packages/webui` で開始、安定後に分割)
- **CRDT / broker / k/v store + watcher は不適**: CRDT 重い、broker 運用負荷で衝突、watcher 中途半端 → **jsonl + sqlite が素直** (= 既存方針肯定)

### 設計上の inconsistency / contradictions (要解決)

- 「既存 p2p 脅威が構造的に消える」と「socket/web 同じ contract」は緊張する: HTTP API で攻撃面拡大、脅威は減るのではなく集中する
- v2 proposal の「p2p の上に room layer」と kawaz の「daemon first / rewrite 別 repo」が明示せず採用されている: 設計経緯が読みにくい → DR で経緯を明文化
- `room log = immutable jsonl` と `member 増減の冪等性` と `move event` が同居で、membership 現在状態を sqlite にも持つなら **整合・再構築ルール** が必要 → **source of truth = jsonl** で sqlite はキャッシュと明記
- daemon 透明起動と web UI (起動状態 / API token / CORS / port 表示が必要) は **UX が割れる** → web UI は明示的 opt-in

### Prior Art (参考のみ、採用候補なし)

- **設計パターン参考**: Redis Streams (consumer group / pending / last delivered ID / trim / backpressure)、NATS JetStream (durable consumer / ack / replay / queue policy)
- **反面教師**: Matrix (federation / state resolution は過剰)、XMPP (extension 地獄)、MQTT (chat log には足りない)、ZeroMQ (durability/cursor/replay 自前)
- **採用候補**: なし (個人 local tool には全部過剰、自前 jsonl + sqlite が正解)

## codex review を受けた次アクション (= TODO)

- [ ] **single host vs multi-host を kawaz と決定** (= 設計の岐路)
- [ ] **MVP スコープを最小化**: local daemon + create_room/post/subscribe + jsonl + sqlite cursor + minimal CLI のみ。web UI / mTLS / mobile / 検索 / merged view は別 phase
- [ ] **daemon supervision strategy を decide**: launchd/systemd or plugin spawn どちら? PID file / health check / backoff / stale socket cleanup を仕様化
- [ ] **Auth model を文章化**: 127.0.0.1 only / web disabled by default / token rotation の default、外部公開は別 DR
- [ ] **Backpressure policy**: per-client ring buffer + drop policy + push は通知のみ・本文は pull
- [ ] **bun vs Go の言語選定 DR**: crash 特性 / 配布 / sqlite-WAL/UDS 周りの実機検証
- [ ] **monorepo で開始**: `claude-ccmsg/{packages/daemon, packages/cli, packages/webui}` で始める、安定後に分割判断
- [ ] **「脅威が消える」を「境界が変わる」に書き直す**: 本 issue 本文も該当箇所を訂正

## 結論 (= kawaz 方針への codex 評価)

- **中央デーモン + jsonl + sqlite の方向性は正しい** (= CRDT/broker/k/v が不適と否定された結果としても支持)
- ただし **「daemon にすれば全部解決」ではない**: AI-to-AI noise は別レイヤ (room 権限 / mention / rate limit)、threat は境界移動、MVP スコープ最小化、daemon supervision / backpressure / auth の具体化が必要
- **rewrite 戦略 (cmux-msg を p2p で残し別 repo で ccmsg)** は妥当だが、**MVP は monorepo 推奨** (= API 激変期の repo 分割摩擦回避)
