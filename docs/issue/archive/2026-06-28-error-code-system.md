---
title: エラーコード体系 + exit code 規約化 (機械可読 stable ID)
status: discarded
category: request
created: 2026-06-28T20:24:44+09:00
last_read: 2026-06-29T00:00:00+09:00
open_entered: 2026-06-28T20:24:44+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered: 2026-06-29T10:43:14+09:00
resolved_entered:
discard_reason: ["discarded:rewrite 戦略下で cmux-msg は p2p 機能のまま安定維持となり、新規 error code 体系導入は YAGNI。error code 設計は ccmsg (新リポ) 側で再検討。kawaz 判断で close"]
pending_reason:
close_reason: ["discarded:rewrite 戦略下で cmux-msg は p2p 機能のまま安定維持となり、新規 error code 体系導入は YAGNI。error code 設計は ccmsg (新リポ) 側で再検討。kawaz 判断で close"]
blocked_by:
origin: claude-cmux-msg
---

# エラーコード体系 + exit code 規約化 (機械可読 stable ID)

> ⚠️ **rewrite 戦略下で YAGNI 寄り** (2026-06-29 トリアージ更新): [central-daemon-architecture](./2026-06-29-central-daemon-architecture.md) で rewrite が決まると、cmux-msg は p2p 機能のまま安定維持となり、新規 error code 体系導入の優先度は低い。error code 設計は ccmsg 側で再検討。**close 候補**、kawaz 判断待ち。

## 概要

cmux-msg のエラーメッセージは全部日本語自由文 (例: `[error] 同一 session_id の subscribe が既に起動中です`)。AI consumer が `grep '同一 session_id'` でパースする運用は**文言改訂で破綻**する。stable な error code (例: `ERR_SUBSCRIBE_LOCK_HELD`) を持たない。

同様に exit code は **0/1 に潰れて**おり、`check-subscribe` の (0/1/2) 体系だけが例外。AI が exit code 分岐できないため、stderr 文言の grep に頼らざるを得ない。

## 背景

アクセシビリティ専門家レビューで以下の観点が上がった。

### Critical

1. **エラーコード体系の不在**
   - 全エラーが日本語自由文、stable identifier なし
   - 提案: `src/lib/errors.ts` を拡張し `{code: 'ERR_XXX', message_ja, message_en, hint}` 形式
   - 例: `ERR_SUBSCRIBE_LOCK_HELD` / `ERR_SUBSCRIBE_BUSY_SQLITE` / `ERR_PEER_NOT_FOUND` / `ERR_PEER_DEAD` / `ERR_CROSS_HOME_WARNING` / `ERR_USAGE` / `ERR_SID_UNRESOLVED`

2. **exit code 体系の規約化**
   - 現状: 多くの cmd で 0/1 のみ。lock 競合 / sid 未解決 / usage error / I/O error が全部 1 に潰れる
   - 提案規約 (案):
     - 0: success
     - 1: generic error (= 既存互換)
     - 2: usage error (= argv parse 失敗)
     - 3: lock 競合 (subscribe lock 既に holder あり)
     - 4: not-found (= peer / file が無い)
     - 5: sid 未解決 (= check-subscribe で既に使われている値)
   - `check-subscribe` の (0/1/2) は既存規約として尊重し、新規 cmd は本規約に従う

### Warning

3. **`--json` 偏在**
   - `history` / `thread` のみ対応。`peers` / `whoami` / `list` / `read` / `notify` (送信結果) には無い
   - AI 主用途を考えると全 read-only cmd に `--json` を揃えるべき
   - 特に `peers --json` は grouping 結果のパース運用上必須レベル

4. **多言語混在**
   - stderr/help/コメント全部日本語。エラーメッセージは `code` を英語 stable ID、表示文言を ja/en pair で出すのが pragmatic

5. **DR-0017 payload schema の JSON Schema 化**
   - JSON Schema (`docs/schemas/notify-payload.schema.json`) として機械可読化すれば AI consumer の検証が自動化できる

6. **severity prefix の全 cmd 統一**
   - `[error]` / `[warn]` / `[info]` は一部統一されているので、全 cmd に拡大すれば log parser が書きやすい

## 設計判断が必要な点

- error code 命名規約 (snake_case_upper or hyphen-case)
- ja/en pair をどう表現するか (JSON 出力 vs テキスト 2 行 vs locale 切替)
- 後方互換: 既存 error message を変えると AI script の grep が break する
- 影響範囲が大きい (= 全 cmd を touchpoint で、1 PR では収まらない)

→ kawaz 判断待ち。本 issue は段階的 implementation の入口。

## スコープ案

1. **Phase 1**: `src/lib/errors.ts` に code 構造を導入、新エラーは code 付きで実装
2. **Phase 2**: 既存エラーを段階的に code 付きに移行 (PR 単位で)
3. **Phase 3**: 全 read-only cmd に `--json` 追加
4. **Phase 4**: 全 stderr の severity prefix 統一

## 受け入れ条件

- [ ] error code の命名規約と JSON 出力構造の DR 起票
- [ ] phase 1 完了 (lib/errors.ts に code 構造、新規エラーは code 付き)
