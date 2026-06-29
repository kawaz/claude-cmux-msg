---
title: release.yml + 自動 tag + GH Release を整備 (release-flow-awareness 適合)
status: open
category: request
created: 2026-06-28T20:33:50+09:00
last_read: 2026-06-29T09:17:24+09:00
open_entered: 2026-06-28T20:33:50+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: claude-cmux-msg
---

# release.yml + 自動 tag + GH Release を整備 (release-flow-awareness 適合)

> ⚠️ **room-based-messaging とは独立、優先度判断のみ保留** (2026-06-29 トリアージ): release flow 整備自体は room 設計と独立。ただし「現フェーズは room 設計に集中」と判断され順序保留。room 方針 land or kawaz 指示で着手可。

## 概要

現状: `just push` は version 3 ファイルの bump + main push のみ。**git tag / GH Release / release.yml** は不在。

kawaz の `[[release-flow-awareness]]` rule (リリース flow standard) に従うと、リリース成果物を持つプロジェクトでは:

1. `bump-version` task が VERSION (cmux-msg では plugin.json / marketplace.json / package.json) を更新して commit
2. main push で **release.yml が VERSION 変更を trigger に起動**
3. workflow 内で「既存 tag より大きいか」を semver で検証
4. OK なら build → `gh release create "v${VERSION}"` で **workflow 自身が tag + GH Release を作成**

を要求する。canonical 実装: `kawaz/bump-semver` の release.yml。

## 背景

DevOps 視点レビューで指摘 (重要度 Critical):

- **audit trail なし**: 8 patch bumps を 1 日でやったが GH Release が無いので "v0.31.2 で何が出荷されたか" の正規記録が存在しない (CHANGELOG しかない)
- **rollback target 不明**: "revert v0.31.2" を簡単に表現する手段が無い (= git tag が無いので commit hash 直指定が必要)
- **plugin update 伝播の不確実性**: `claude plugin marketplace update` が手動で、release.yml で marketplace.json を canonical 化する仕組みが無い

## スコープ

### Phase 1 (本 issue)

- `.github/workflows/release.yml` を canonical 実装 (bump-semver の release.yml をテンプレに) で新規追加:
  - `on: push: branches:[main] + paths:[.claude-plugin/plugin.json]`
  - build (= bun typecheck + test + claude plugin validate) → tag 検証 → `gh release create`
  - release body は CHANGELOG.md の該当 version section から抽出
- `justfile` の `push` で release.yml 起動を見届けるための `gh-monitor:watch-workflow` hint を追記

### Phase 2 (別 issue)

- CHANGELOG 自動生成 (git-cliff or conventional-commits)
- plugin update 後のローカル `claude plugin update` 自動化 (現状 `just push` 末尾で `claude plugin update` を叩いてるが、これは push 主にしか効かない)

## 受け入れ条件

- [ ] release.yml が main push で起動し、tag + GH Release を自動作成する
- [ ] v0.31.x からの release が全部 GH Release に並ぶ (= rollback target が tag で表現可能)
- [ ] CHANGELOG.md と GH Release の body が一致する

## 関連

- canonical: kawaz/bump-semver の release.yml
- kawaz personal rule: [[release-flow-awareness]]
