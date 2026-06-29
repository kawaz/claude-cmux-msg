---
title: プロダクト名 / env prefix を branding 集約 (DR-0013 rename 準備)
status: discarded
category: request
created: 2026-06-28T20:38:04+09:00
last_read: 2026-06-29T09:00:00+09:00
open_entered: 2026-06-28T20:38:04+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered: 2026-06-29T10:42:02+09:00
resolved_entered:
discard_reason: ["discarded:rewrite 戦略 (central-daemon-architecture) で新リポ claude-ccmsg に作り直すため、既存 cmux-msg の rename (DR-0013) 自体が不要化。kawaz 判断で close"]
pending_reason:
close_reason: ["discarded:rewrite 戦略 (central-daemon-architecture) で新リポ claude-ccmsg に作り直すため、既存 cmux-msg の rename (DR-0013) 自体が不要化。kawaz 判断で close"]
blocked_by:
origin: claude-cmux-msg
---

# プロダクト名 / env prefix を branding 集約 (DR-0013 rename 準備)

> ⚠️ **rewrite 戦略下で不要化候補** (2026-06-29 トリアージ更新): [central-daemon-architecture](./2026-06-29-central-daemon-architecture.md) で rewrite 戦略 (新リポ `claude-ccmsg` で別実装) が採用された場合、DR-0013 (cmux-msg → ccmsg rename) 自体が不要化される。既存 cmux-msg は cmux-msg のまま安定維持。→ **close 候補**、kawaz 判断待ち。

## 概要

DR-0013 (Accepted) でプロダクト名を `cmux-msg` → `ccmsg` に rename することが決まっているが、**現状の実装はプロダクト名をハードコードで散在させている**。rename 時の手間が大きく、変更漏れの risk もある。

建築家視点レビューで指摘 (Critical)。

## 背景

散在箇所:

- `src/cli.ts:121,28-69`: HELP テキスト全体に `cmux-msg` ハードコード
- `src/hooks/session-start.ts:139-141`: SessionStart 出力テキストで `cmux_msg_bin` / `cmux-msg` 等
- `src/config.ts:97`: `pluginRoot()` warning で `cmux-msg` 言及
- `src/types.ts:45,57`: comment で `cmux-msg` 言及
- env prefix `CMUXMSG_*`: コード全体に散在 (例: `CMUXMSG_BASE` / `CMUXMSG_SESSION_ID` / `CMUXMSG_TAGS` / `CMUXMSG_PRIORITY` / `CMUXMSG_REPLY_TO` / `CMUXMSG_TYPE`)
- bin/cmux-msg ラッパー名 (= file 名自体)
- `.claude-plugin/plugin.json` / `marketplace.json` の name フィールド
- README / SKILL / DESIGN / DR / journal / etc (docs 全部)

## 提案: branding 集約

`src/branding.ts` (or `src/config.ts` 末尾) に集約:

```ts
export const PRODUCT_NAME = 'cmux-msg' // DR-0013 で 'ccmsg' に変更予定
export const ENV_PREFIX = 'CMUXMSG'    // 同上 'CCMSG' に
export const BIN_NAME = 'cmux-msg'     // 同上 'ccmsg' に

// env name helpers
export const ENV_BASE = `${ENV_PREFIX}_BASE`
export const ENV_SESSION_ID = `${ENV_PREFIX}_SESSION_ID`
export const ENV_TAGS = `${ENV_PREFIX}_TAGS`
export const ENV_PRIORITY = `${ENV_PREFIX}_PRIORITY`
// ...
```

各 file で env 文字列 / プロダクト名を直書きする箇所を上記定数に置き換える。

メリット:
- DR-0013 rename 時の変更が **branding.ts 数行で完了**
- env 名の typo 防止
- AI が新コード書く時に branding 一貫性が自動

デメリット:
- 大量 file の touch (= 1 PR の diff が広範)
- env access が `process.env[ENV_BASE]` (= bracket access) になり、若干冗長
- 既存 grep ('CMUXMSG_BASE' を直接探したいケース) で見つかりにくくなる懸念

## DR-0013 との関係

DR-0013 で rename 実施時は本 issue を依存先に。本 issue を先に完了させることで rename 自体は **1 commit で完了** できるようになる。

## 受け入れ条件

- [ ] `src/branding.ts` (or 集約場所) に定数集合
- [ ] src/ 内の env 文字列 + プロダクト名直書きを定数経由に変換
- [ ] 既存 test 全 pass
- [ ] 残るハードコードは bin/cmux-msg (ラッパー名) と docs / package metadata だけになる

## 関連

- DR-0013: ccmsg への rename (本 issue が完了すると実施が劇的に楽になる)
