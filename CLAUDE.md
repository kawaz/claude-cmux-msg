# cmux-msg

複数の Claude Code セッション間でファイルベースのメッセージをやり取りする Claude Code プラグイン。任意の起動形態 (ターミナル直起動 / cmux / tmux / SSH / bg job 等) で動作し、特定の terminal multiplexer に依存しない。

> プロダクト名 `cmux-msg` は名称負債 (DR-0013 で `ccmsg` への rename を予定)。動作上は cmux 非依存。

## 識別子モデル (DR-0004 / DR-0010 stage 2)

- **メッセージングの主体 = session_id (sid)**。`claude --session-id <uuid>` で採番された UUID v4
- 受信箱は `<CMUXMSG_BASE>/<sid>/{inbox,accepted,archive,sent,tmp,meta.json}` (sid 直接)
- cwd / repo / claude_home / tags は sid に紐付くメタ情報として `meta.json` と DB `sessions` 行に記録
- session_id の解決順:
  1. `$CLAUDE_CODE_SESSION_ID` env (Claude Code 2.x で Bash 子プロセスに渡される)
  2. `$CMUXMSG_SESSION_ID` env (互換 / 手動指定用)
- **state トラッキング**: SessionStart / UserPromptSubmit / Stop / StopFailure / PermissionRequest / SessionEnd hook が `state` (`idle` / `running` / `awaiting_permission` / `stopped`) を更新
- **グルーピング軸**: `peers --by home|cwd|repo|tag:<name>`。複数 `--by` は AND。軸なしは help (peers) / error (broadcast)

## 構造

```
.claude-plugin/     # プラグインメタデータ (plugin.json, marketplace.json)
src/                # TypeScript ソースコード
  cli.ts            # エントリポイント
  commands/         # サブコマンド実装
  hooks/            # プラグインフック (SessionStart 等)
  lib/              # 共通ライブラリ
  config.ts         # 設定管理
  types.ts          # 型定義
bin/
  cmux-msg          # bash ラッパー (bun で src/cli.ts を直接実行、git 管理対象)
skills/cmux-msg/    # スキル定義 (SKILL.md)
hooks/              # プラグインフック定義 (hooks.json)
```

## 開発

cmux-msg は `bun` を必須要件とし、TypeScript (`src/cli.ts`) を常に直接実行する。コンパイル工程は無い。
- `bin/cmux-msg` は bash ラッパー (git 管理対象)。常に `bun run src/cli.ts` を exec する
- 型チェック: `bun run typecheck` (`tsc --noEmit`)
- テスト: `bun test`
- 検証: `claude plugin validate .`
- 全チェック: `just ci` (lint→typecheck→test→validate、CI とローカルで同じ範囲)

## push

`just push` を使う。以下を自動チェック:
- lint / typecheck / test
- plugin.json と marketplace.json のバージョン一致
- main@origin からの変更に対するバージョン bump 必要性

## jj ワークフロー

このリポジトリは git bare + jj workspace 方式で管理。git コマンドは使わない。
