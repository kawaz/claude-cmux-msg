# リポジトリ構造

```
.claude-plugin/         Claude Code プラグインマニフェスト (plugin.json, marketplace.json)
hooks/                  プラグインフック定義 (hooks.json)
skills/cmux-msg/        スキル定義 (SKILL.md)
completions/_cmux-msg   zsh 補完
cmux-msg.plugin.zsh     zsh プラグインエントリ (alias で bin/cmux-msg を指す)

bin/
  cmux-msg              bash ラッパースクリプト (git 管理)
  cmux-msg-bin          bun build --compile の成果物 (gitignore)

src/
  cli.ts                エントリポイント、サブコマンドディスパッチ
  config.ts             env 解決 (getSessionId, requireCmux 等)
  types.ts              MessageMeta / PeerMeta 型
  commands/             各サブコマンド実装
  hooks/                SessionStart hook
  lib/
    sender.ts           メッセージ送信 (sendMessage)
    inbox.ts            受信読み出し (listInbox / readMessage / countInbox)
    transition.ts       状態遷移 (accept / dismiss / reply)
    history.ts          history / thread の集約処理
    paths.ts            ベースパス解決 (getMsgBase)
    peer.ts             peer 列挙・生存判定
    peer-refs.ts        peer の surface_ref 解決
    layout-docs.ts      各階層 README symlink 配置
    cmux.ts             cmux CLI ラッパー
    frontmatter.ts      YAML frontmatter パース
    session-index.ts    by-surface インデックス
    subscribe.ts        diffInbox (subscribe コマンドの差分計算)
    validate.ts         入力検証 (UUID, name, filename, shellSingleQuote)
    format.ts           CLI 出力整形 (shortId, TYPE_LABEL_WIDTH)
    errors.ts           UsageError

docs/
  design/               実装設計
    data-layout-*.md    ランタイムデータディレクトリ自己言及の正本 (各階層に symlink で貼る)
  decisions/            DR (Decision Record)
    INDEX.md            DR 一覧
    DR-NNNN-title.md    各 DR
  findings/             短期・単発の調査ログ (YYYY-MM-DD-title.md)
  structure.md          このファイル
  roadmap.md            将来検討項目

justfile, package.json, tsconfig.json, .gitignore, .envrc
README.md / README-ja.md (日本語が原本)
CHANGELOG.md            Keep a Changelog 形式
CLAUDE.md               リポジトリ固有の AI 向け指示
```

## ランタイムデータレイアウト

cmux-msg が起動時に作る `~/.local/share/cmux-messages/` 配下の構造は `docs/design/data-layout-{root,workspace,session}.md` に詳細を記述。これらはランタイムで `.docs/v<version>/` にコピーされ、各階層の `README.md` が symlink で参照する。
