# DR-0019: cmux 連携機能を完全除去 (spawn / tell / screen / stop / lib/cmux* / CMUX_* env)

- Status: Accepted (2026-06-28, kawaz 明示指示)
- Date: 2026-06-28
- Supersedes parts of: [DR-0010](DR-0010-drop-cmux-environment-requirement.md) (cmux 環境必須廃止 stage 1 を stage 2 で完結)
- Related: [DR-0011](DR-0011-drop-tell-command.md) (tell 廃止)、[DR-0009](DR-0009-hyoui-delegation.md) (hyoui 委譲)

## 背景

DR-0010 stage 1 で「cmux 環境外でも messaging を動かす」化を進めたが、ライフサイクル系 (`spawn` / `stop`) と pane 操作系 (`tell` / `screen`) は cmux 専用機能として残置していた。これらは:

- AI agent がユーザの hyoui 指示を取り違えて `cmux spawn` を勝手に提案・実行する事故を生む
- cmux 依存の env (`CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` / `CMUXMSG_PARENT_SESSION_ID` / `CMUXMSG_WORKER_NAME` / `CMUXMSG_SURFACE_REF`) が config / hook / meta に散在し、cmux 非依存化の障害になっていた
- `meta.json` の `workspace_id` / `surface_id` / `surface_ref` / `worker_name` / `parent_session_id` / `tab_id` フィールドが cmux 専用のメタ情報として残っており、`peers --by ws` 軸が cmux 由来の workspace UUID 比較で機能していた
- DR-0011 で tell-guard は削除されたが、tell / screen / stop 本体や lib/cmux 系は残置
- DR-0013 で「cmux」を含む名前を `ccmsg` に rename 予定だが、機能自体が cmux 依存だったため rename しても本質的な依存は残る

kawaz から明示的に「cmux 関連コード除去を優先」「CMUX 環境変数系も全部対象」と指示。

## 決定

### 1. cmux 専用コマンドの完全削除

- `src/commands/spawn.ts` / `spawn.test.ts` 削除
- `src/commands/stop.ts` 削除
- `src/commands/tell.ts` 削除
- `src/commands/screen.ts` 削除

これらの責務 (= 子 CC 起動 / pane 終了 / pane 操作 / 画面読み取り) は cmux-msg のスコープから完全に外れる。子 CC 起動が必要なら `claude --session-id <uuid> ...` を直接叩く。pane 操作は hyoui 等の別 plugin に委譲する。

### 2. cmux 専用 lib の完全削除

- `src/lib/cmux.ts` / `cmux.test.ts` 削除 (cmux daemon の identify / signal ラッパー)
- `src/lib/cmux-surface.ts` / `cmux-surface.test.ts` 削除 (tty → surface 逆引き)
- `src/lib/tell-guard.ts` / `tell-guard.test.ts` 削除 (= DR-0011 で既定だが念のため確認)
- `src/lib/session-index.ts` / `session-index.test.ts` 削除 (`CMUX_SURFACE_ID` → session_id の by-surface index)
- `src/lib/peer-refs.ts` / `peer-refs.test.ts` 削除 (peer の cmux surface 解決)
- `src/lib/deny-log.ts` / `deny-log.test.ts` 削除 (tell / screen の拒否ログ、tell/screen 削除に伴い不要)

### 3. CMUX_* env / meta フィールドの全廃

- `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` / `CMUX_TAB_ID` の参照を src / hook / test から完全削除
- `CMUXMSG_PARENT_SESSION_ID` / `CMUXMSG_WORKER_NAME` / `CMUXMSG_SURFACE_REF` の参照を src / hook / test から完全削除
- `PeerMeta` から `parent_session_id` / `worker_name` / `workspace_id` / `tab_id` / `surface_id` / `surface_ref` を削除
- `getWorkspaceId()` / `getTabId()` / `requireCmux()` / `SPAWN_COLORS` を `src/config.ts` から削除
- session_id 解決順から「`<base>/by-surface/<CMUX_SURFACE_ID>` lookup」(旧 3 番目) を削除。残るのは `CLAUDE_CODE_SESSION_ID` → `CMUXMSG_SESSION_ID` の 2 段のみ

### 4. peer-filter から `ws` 軸を削除

- `--by ws` (= `workspace_id` 比較) を削除。`workspace_id` 自体が cmux 由来で、cmux 非依存化により意味を失う
- 代替: 同 worktree / 同 repo の grouping は `--by repo` で代用 (scope-hash の `ws` (= git worktree root) は DB の `sessions.ws` 列としては残るが、peer-filter は `meta.json` ベースで動作しているため `--by ws` の意味論を保つには `PeerMeta` への新 `ws` フィールド追加が必要。本 DR では追加せず削除する方を選択)

### 5. SessionStart hook の cmux signal / identify 経路を削除

- `cmuxIdentify` (`CMUX_SURFACE_ID` → `surface:N` 逆引き) 呼出を削除
- `cmuxSignal` (spawn 親への完了通知) 呼出を削除
- `writeBySurfaceIndex` (by-surface lookup の書き込み) 呼出を削除
- `parentSessionId` / `workerName` ベースの「spawned-worker」context 出力を削除し、通常の hook context のみに統一

### 6. sender からの cmuxSignal 削除

- `sendMessage` 末尾の `cmuxSignal(\`cmux-msg:${target}\`)` を削除
- 受信側への通知は subscribe の `fs.watch` が拾うので明示的 signal は不要

### 7. docs の更新

- `README.md` / `README-ja.md` / `CLAUDE.md` / `skills/cmux-msg/SKILL.md` / `docs/STRUCTURE.md` / `docs/ROADMAP.md` / `docs/design/data-layout-*.md` から cmux 依存記述を削除
- `docs/runbooks/spawn-troubleshooting.md` 削除 (spawn 機能自体が消滅)
- `.claude-plugin/plugin.json` / `marketplace.json` の description を cmux 非依存に書き換え

### 8. プロダクト名 `cmux-msg` の扱い

本 DR では rename は実施しない。**動作上は cmux 非依存**だが、`cmux-msg` という名前は維持する (DR-0013 が `ccmsg` への rename を扱う、本 DR とは独立)。これは:

- breaking change を rename と混ぜると影響範囲の切り分けが困難
- rename は `bin/cmux-msg` / plugin name / install path / shell completion など更に広範囲に波及

DR-0013 の rename と本 DR の cmux 機能削除は **別 release** で land する。

## 不採用

- **spawn だけ削除して tell / screen / stop / lib/cmux は残す**: cmux に依存する CLI が一部でも残ると、AI agent が「cmux pane 操作を依頼された」と誤解して `cmux-msg tell` を提案する事故が続く。CMUX_* env が残ると hook / meta に「cmux 機能の痕跡」が散在し、ユーザの認知負荷を増やす。kawaz の指示も「cmux 関連コード除去を優先」「CMUX 環境変数系も全部対象」と全削除を明示
- **CLI コマンドだけ削除して PeerMeta の cmux フィールドは互換のため残す**: 後方互換性を理由に設計の歪みを残さない (`design-priority` rule)。`meta.json` の旧 `workspace_id` / `surface_id` フィールドは無視される (= 読み捨て)、新規 write からは消える
- **`ws` 軸を `PeerMeta.ws` 新フィールドで再定義**: scope-hash の `ws` (worktree root) を meta に乗せれば peer-filter で再利用可能だが、scope-hash の `ws` は cwd 由来で値ぶれが起きやすく、`--by repo` で実用上ほぼ代用可能。追加コストに見合わない

## 影響範囲

### Breaking changes

- `cmux-msg spawn` / `stop` / `tell` / `screen` は exit code 1 + "不明なコマンド" になる
- `--by ws` 軸は使えなくなる (`--by repo` で代用)
- `meta.json` から `workspace_id` / `surface_id` / `surface_ref` / `worker_name` / `parent_session_id` / `tab_id` が消える (= 旧フィールドは古い meta.json には残るが、コード側は読まなくなる)
- CMUX_* env / CMUXMSG_PARENT_SESSION_ID / CMUXMSG_WORKER_NAME / CMUXMSG_SURFACE_REF を設定しても無視される

### バージョン

minor bump (= patch 内で済まない interface 変更)。プロダクト名 `cmux-msg` rename は別 release。

## 関連

- DR-0010 stage 1: cmux 環境必須廃止 (= 「cmux 環境外でも動く」化)
- DR-0011: tell コマンド廃止
- DR-0013: `cmux-msg` → `ccmsg` rename (= 名前の負債解消)
- DR-0009: hyoui delegation
- DR-0007: resume resilience (spawn / tell の安全境界、本 DR で関連責務消滅)
