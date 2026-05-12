# 2026-05-12: DR-0004 (session-as-primary-key) 実装記録

## 経緯

DR-0003 で「session_id は workspace 横断的に一意」を前提に `peerDir(sid)` を全 ws 走査 fallback で解決する暫定実装 (0.25.4) を入れて push。その後 dogfood 中に「同じ session_id が複数 workspace 配下に dir を持つ」現象が確認され、DR-0003 の前提崩れが判明。

## 発見の鍵

実際の `~/.local/share/cmux-messages/` を `ls` で確認したら、`a40e29fb-...` の同じ sid が `7BE777CC-...`、`146D53DF-...`、`CAD030C6-...` の 3 workspace 配下に dir を持っていた。`kill -0 <shell_pid>` で alive 確認したところ 1 つだけ alive、他は dead。これは「resume で別 ws 環境に持ち越され、SessionStart hook が新 ws 配下に dir を作って初期化、旧 ws の dir は dead で残置」の結果。

## モデル再構築 (DR-0004)

- **メッセージング主体 = session_id (sid)** に一意化
- 受信箱は `<base>/<sid>/` 直接構造 (workspace_id 階層を廃止)
- workspace / surface / cwd / repo / claude_home / tags はすべて sid 紐付けで `meta.json` に書く
- グルーピングは多軸 (`--by home|ws|cwd|repo|tag:<name>`) の filter で対応
- state トラッキング (idle / running / awaiting_permission / stopped) を hook で管理
- tell / screen に fg + state ガード追加 (誤誘導防止)
- broadcast は軸明示必須、`--all` で全送信明示
- migration は C 案 (旧構造を読まず、新構造で再構築)

## 実装の流れ

1. **段階 1+2 (レイアウト + meta schema)**: `src/lib/paths.ts` / `src/config.ts` / `src/types.ts` / `src/lib/state.ts` / `src/lib/repo-root.ts` を新規 or 書き換え。`peerDir(sid)` の全 ws 走査 fallback を削除して `<base>/<sid>/` 直接に。
2. **段階 3 (新 hook)**: `src/lib/state-hook.ts` を共通ロジックとして抽出、各 hook (stop / stop-failure / permission-request / session-end) は薄いラッパー。`hooks.json` に追加。
3. **段階 4 (安全境界)**: `src/lib/peer.ts` に `isProcessForeground()` 追加 (`ps -o stat= -p <pid>` の `+` フラグ判定)。`tell` は fg + state ∈ {idle, awaiting_permission}、`screen` は fg 必須。
4. **段階 5 (filter)**: `src/lib/peer-filter.ts` 新規、`--by <axis>` / `--all` を peers / broadcast に組み込み。複数 --by は AND、軸なしは help (peers) / error (broadcast)。
5. **段階 6 (tests)**: workDir/WS/SID → workDir/SID への一括書き換え。`CLAUDE_CODE_SESSION_ID` 環境変数が getSessionId で優先される影響でテスト側で明示クリア必要 (ハマり所)。
6. **段階 7 (docs)**: SKILL.md / README / CLAUDE.md / data-layout-*.md を新モデルに更新。
7. **段階 8 (CI + bump)**: `just ci` 通して `just bump-version minor` で 0.26.0、`just push`。

## ハマり所

- **`CLAUDE_CODE_SESSION_ID` env がテストで getSessionId() の優先順 1 位に来てしまう** → bun test 実行時に親 (claude) の env が伝播し、テスト側で `delete process.env.CLAUDE_CODE_SESSION_ID` を beforeEach に追加して回避。
- **`docs/design/data-layout-workspace.md` の削除**: jj は git ignore でないファイルを `file untrack` で外せないが、ファイル削除自体は `jj diff` で検出される。`rm -f` で削除して次の commit に含めれば OK。
- **layout-docs.test.ts の workspace 階層削除**: 旧テストが `workspaceId: WS` を渡していた箇所を全削除。setupLayoutDocs の SetupLayoutOptions から workspace_id を除去。
- **CMUXMSG_TAGS の伝播**: meta schema に `tags: []` を追加したが、spawn 側で env として子に渡す実装が初期実装漏れだった → 後追いで `spawn --tags <csv>` を実装 (0.27.0)。

## Phase 1 後の追加改善 (同日)

0.26.0 push 後に dogfood しながら気づいた小改善:
- `spawn --tags csv` (0.27.0): meta.tags を初期化、後で `--by tag:NAME` 絞り込み可能
- `readMeta` 共通化 (0.27.1): peers / broadcast / tell / screen に重複していたヘルパを `src/lib/meta.ts` に集約
- `cli.ts` HELP テキスト更新 (0.27.2): peers/broadcast の --by 必須化を反映
- `completions/_cmux-msg` 更新 (0.27.3): zsh 補完を新オプションに追従

## 教訓

- **実体に合わないモデルは早く捨てる**: DR-0003 は「sid が workspace 横断で一意」を前提に書いたが、resume 痕跡で前提が崩れることに dogfood で気づいた。前提検証を実機で 1 回でもしていれば DR-0003 段階で気づけた可能性。
- **大きな設計変更は段階に切る**: 8 段階に分けて TaskCreate + addBlockedBy で依存グラフを作ったことで、途中で迷子にならず順次着手できた。
- **メタ情報拡張は env 経路まで含めて完成形を考える**: meta.tags フィールドを足しても、それを書き込む CLI 経路 (spawn --tags) が無いと実用化できない。Phase 1 範囲では env-only と割り切ったが、push 後すぐに `--tags` を足した。
