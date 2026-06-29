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
