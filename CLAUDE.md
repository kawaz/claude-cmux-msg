# cmux-msg

cmux（libghosttyベースのターミナル）上で複数の Claude Code セッション間のファイルベースメッセージングを提供する Claude Code プラグイン。

## 識別子モデル

- **通信単位 = claude session UUID** (`CMUXMSG_SESSION_ID`)。`claude --session-id <uuid>` で採番
- **画面操作 = cmux surface_ref** (`surface:N`)。tell / screen / stop の内部で使う
- spawn は親が UUID を先行生成して `claude --session-id <uuid>` で起動。逆引きや polling は不要
- peer の surface_ref は peer 自身の `meta.json` に書かれる。共有マップファイルは持たない

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

ビルド: `bun run build` (src/cli.ts → bin/cmux-msg にコンパイル)
テスト: `bun test`
検証: `claude plugin validate .`
全チェック: `just all`

## push

`just push` を使う。以下を自動チェック:
- バンドル (bin/cmux-msg) が最新か
- plugin.json と marketplace.json のバージョン一致
- main@origin からの変更に対するバージョン bump 必要性

## jj ワークフロー

このリポジトリは git bare + jj workspace 方式で管理。git コマンドは使わない。
