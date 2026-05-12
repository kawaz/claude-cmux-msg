# cmux-msg

cmux（libghosttyベースのターミナル）上で複数の Claude Code セッション間のファイルベースメッセージングを提供する Claude Code プラグイン。

## 識別子モデル (DR-0004)

- **メッセージングの主体 = session_id (sid)**。`claude --session-id <uuid>` で採番された UUID v4
- 受信箱は `<CMUXMSG_BASE>/<sid>/{inbox,...,meta.json,pid}` (sid 直接、workspace 階層なし)
- workspace / surface / cwd / repo / claude_home / tags は sid に紐付くメタ情報として `meta.json` に記録
- **画面操作 = cmux surface_ref** (`surface:N`)。tell / screen / stop の内部で使う。peer の surface_ref は peer 自身の `meta.json` から引く
- spawn は親が UUID を先行生成して `claude --session-id <uuid>` で起動。逆引きや polling は不要
- session_id の解決順:
  1. `$CLAUDE_CODE_SESSION_ID` env (Claude Code 2.x で Bash 子プロセスに渡される)
  2. `$CMUXMSG_SESSION_ID` env (互換)
  3. `<base>/by-surface/<CMUX_SURFACE_ID>` lookup file (CLAUDE_ENV_FILE バグ Issue #15840 回避)
- **state トラッキング**: SessionStart / UserPromptSubmit / Stop / StopFailure / PermissionRequest / SessionEnd hook が `state` (`idle` / `running` / `awaiting_permission` / `stopped`) を更新。`tell` の安全境界に使う
- **グルーピング軸**: `peers --by home|ws|cwd|repo|tag:<name>`。複数 `--by` は AND。軸なしは help (peers) / error (broadcast)

## 構造

```
.claude-plugin/     # プラグインメタデータ (plugin.json, marketplace.json)
src/                # TypeScript ソースコード
  cli.ts            # エントリポイント
  commands/         # サブコマンド実装
  hooks/            # プラグインフック (SessionStart等)
  lib/              # 共通ライブラリ
  config.ts         # 設定管理
  types.ts          # 型定義
bin/                # ビルド成果物 (git管理外)
  cmux-msg          # bun compile バイナリ
skills/cmux-msg/    # スキル定義 (SKILL.md)
hooks/              # プラグインフック定義 (hooks.json)
```

## 開発

ビルド: `bun run build` (src/cli.ts → bin/cmux-msg-bin にコンパイル)
- `bin/cmux-msg` は bash ラッパー（git 管理対象）。ラッパーが bin/cmux-msg-bin があれば exec、なければ bun run にフォールバックする
- `bin/cmux-msg-bin` は gitignore（コンパイル成果物）
テスト: `bun test`
検証: `claude plugin validate .`
全チェック: `just ci` (CI とローカルで同じ範囲を検査)

## push

`just push` を使う。以下を自動チェック:
- コンパイル済みバンドル (bin/cmux-msg-bin) が生成可能か
- plugin.json と marketplace.json のバージョン一致
- main@origin からの変更に対するバージョン bump 必要性

## jj ワークフロー

このリポジトリは git bare + jj workspace 方式で管理。git コマンドは使わない。
