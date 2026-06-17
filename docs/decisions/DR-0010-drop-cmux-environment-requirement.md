# DR-0010: cmux 環境必須を全廃 (requireCmux / workspace_id / by-surface lookup 削除)

- Status: Accepted (2026-06-17, kawaz 一括承認)
- Date: 2026-06-16
- Supersedes: [DR-0008](DR-0008-messaging-needs-only-session-id.md) (cmux 依存境界の分離自体が不要になるため)
- Related: [DR-0004](DR-0004-session-as-primary-key.md) (sid 主体), [DR-0009](DR-0009-hyoui-delegation.md) (hyoui 委譲、surface 操作系も cmux 不要に)

## 背景

DR-0008 では「messaging は cmux 非依存、surface 操作系 (tell/screen/spawn/stop) は cmux 必須」と分離していた。
ところが本リポは cmux 使用自体を停止し ghostty + hyoui に移行する方針となった (kawaz 2026-06-16)。surface 操作系も DR-0009 で hyoui に委譲されるため、`requireCmux()` ガードの存在意義そのものが消える。

加えて、現状の `SessionStart` hook (`src/hooks/session-start.ts:43-46`) は `CMUX_WORKSPACE_ID` 未設定時に早期 return しており、cmux 環境外では meta.json も作られない。これがメイン session の `whoami` / `peers` 失敗の直接原因 (実機確認: 2026-06-16 練習セッション)。

## 決定

### 1. ガード関数の削除

- `requireCmux()` を削除 (`src/config.ts:72`)
- 残るのは `requireSessionId()` のみ。sid (UUID v4 of `claude --session-id`) を持つかどうかが唯一の前提

### 2. workspace_id 関連の完全削除

- `getWorkspaceId()` 削除 (`src/config.ts:13`)
- `CMUX_WORKSPACE_ID` env 参照を全コードから削除
- meta.json の `workspace_id` フィールド削除 (= types.ts のスキーマ minor bump)
- `SessionStart` hook の早期 return 廃止 → sid さえあれば meta.json 作成

### 3. surface 関連の完全削除

- `CMUX_SURFACE_ID` env 参照を全削除
- `<base>/by-surface/<CMUX_SURFACE_ID>` lookup file 廃止 (Q2 確定: 即廃止)
- meta.json の `surface_ref` フィールド削除
- `src/lib/cmux-surface.ts` / `cmux-surface.test.ts` / `peer-refs.ts` / `peer-refs.test.ts` 削除
- `src/lib/cmux.ts` / `cmux.test.ts` 削除

### 4. session_id 解決経路

優先順 (`CLAUDE_CODE_SESSION_ID` 不在時の代替):

1. `CLAUDE_CODE_SESSION_ID` (Claude Code 2.x が提供、最優先)
2. `CMUXMSG_SESSION_ID` (互換 / 手動指定用)
3. **`HYOUI_SESSION_ID`** (hyoui run 配下の子に常時注入、DR-0020 of hyoui 由来) ← 新規追加

旧 3 段目の `by-surface` lookup は廃止 (Q2 確定)。

## 不採用

- **`CMUX_*` env 名を `CCMSG_*` に rename しつつ仕組みは維持**: 現実装は cmux のターミナル概念 (workspace, surface) に依存しているため、env 名だけ変えても sid 主体 (DR-0004) と整合しない。DR-0013 で別途リネーム作業を行う。
- **`requireCmux()` を `requireHyoui()` に置換**: hyoui 配下で動いていることを必須化するメリットが薄い (hyoui 非利用環境でも messaging だけは使いたい場面が想定される)。sid さえあれば動く設計に統一する。
- **段階的削除 (deprecation 警告 → 削除)**: `design-priority.md` 準拠。0.x の breaking 許容期間中に切る。DR-0009 / DR-0011 と同じ 1.0.0 bump 群に乗せる。

## 影響範囲

- `src/config.ts`: `requireCmux()` / `getWorkspaceId()` 削除
- `src/hooks/session-start.ts`: L43-46 の早期 return 削除、surface 系コード削除、`HYOUI_SESSION_ID` 解決経路追加
- `src/types.ts`: meta スキーマから `workspace_id` / `surface_ref` 削除
- `src/lib/cmux.ts` / `cmux-surface.ts` / `peer-refs.ts` (+ test) 削除
- `<base>/by-surface/` ディレクトリ全廃 (既存 file は 1.0.0 アップグレード時に手動 cleanup)
- README / SKILL.md / cli.ts HELP の cmux 言及を削除

## 既存 issue への影響

- `docs/issue/2026-06-12-hyoui-era-purification.md`: 本 DR + DR-0009 で母体 issue の主要部分を sublimation
- `docs/issue/2026-05-18-cmux-atomic-send-api.md`: 削除 (= cmux 廃止で消滅)
- `docs/issue/2026-05-20-spawn-env-inheritance.md`: 削除 (= CMUX_* 継承自体が消える)
- `docs/issue/2026-05-09-spawn-claude-not-launching.md` 他 cmux 起動失敗系: 削除

## 段階的移行

1. DR-0010 / DR-0009 / DR-0011 を同 PR で land (= 連動して breaking)
2. 既存セッションは cmux 環境変数を持たないまま新版に移行 (= 直近の練習セッションで再現済の構成)
3. cmux env 必須を解いた SessionStart hook で meta.json が作られ、`whoami` / `peers` が動く
4. テストの cmux 依存部分を全削除、合わせて bun:test を通す
5. 1.0.0 bump (DR-0014 / DR-0013 と統合)
