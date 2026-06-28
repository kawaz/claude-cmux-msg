# リポジトリ構造

```
.claude-plugin/         Claude Code プラグインマニフェスト (plugin.json, marketplace.json)
hooks/                  プラグインフック定義 (hooks.json)
skills/cmux-msg/        スキル定義 (SKILL.md)
completions/_cmux-msg   zsh 補完
cmux-msg.plugin.zsh     zsh プラグインエントリ (alias で bin/cmux-msg を指す)

bin/
  cmux-msg              bash ラッパースクリプト (git 管理、bun で src/cli.ts を直接実行)

src/
  cli.ts                エントリポイント、サブコマンドディスパッチ
  config.ts             env 解決 (getSessionId, requireSessionId 等)
  types.ts              MessageMeta / PeerMeta / SessionState 型
  commands/             各サブコマンド実装
  hooks/                プラグインフック (session-start / session-start-ensure-path / user-prompt-submit / stop / stop-failure / permission-request / session-end)
  lib/
    sender.ts           メッセージ送信 (sendMessage)
    inbox.ts            受信読み出し (listInbox / readMessage / countInbox)
    transition.ts       メッセージ状態遷移 (accept / dismiss / reply)
    history.ts          history / thread の集約処理
    paths.ts            ベースパス解決 (getMsgBase)
    peer.ts             peer 列挙・生存判定
    peer-filter.ts      DR-0004: --by <axis> / --all のパース + マッチ判定
    meta.ts             peer の meta.json 読み込み (readMetaByDir / readMetaBySid)
    state.ts            DR-0004: state トラッキング (transitionState / updateMeta)
    state-hook.ts       state 遷移系 hook の共通ロジック
    repo-root.ts        cwd から .git/.jj 親 dir を探す
    layout-docs.ts      各階層 README symlink 配置
    frontmatter.ts      YAML frontmatter パース
    subscribe.ts        diffInbox (subscribe コマンドの差分計算)
    subscriber-state.ts subscribers テーブル (watermark + per-sid lock)
    subscribe-watch.ts  subscribe 検出ロジック (SessionStart hook)
    pid-signature.ts    PID 再利用 false-positive 対策 (lstart 検証)
    sqlite-error.ts     SQLITE_BUSY 系の判定
    force-takeover.ts   subscribe --force の SIGTERM → grace → SIGKILL
    ensure-path.ts      session-start-ensure-path hook の判定ロジック
    validate.ts         入力検証 (UUID, name, filename)
    format.ts           CLI 出力整形 (shortId, TYPE_LABEL_WIDTH)
    errors.ts           UsageError / GuardError

docs/
  design/               実装設計
    data-layout-*.md    ランタイムデータディレクトリ自己言及の正本 (各階層に symlink で貼る)
  decisions/            DR (Decision Record)
    INDEX.md            DR 一覧
    DR-NNNN-title.md    各 DR
  findings/             短期・単発の調査結果 (YYYY-MM-DD-<slug>.md)
  journal/              日々の生記録 (ハマり所→解決策、コマンド・設定値) (YYYY-MM-DD-<slug>.md)
  issue/                自プロ TODO + 上流への要望 (YYYY-MM-DD-<slug>.md、解決時は削除)
  STRUCTURE.md          このファイル
  ROADMAP.md            将来検討項目

justfile, package.json, tsconfig.json, .gitignore, .envrc
README.md / README-ja.md (日本語が原本)
CHANGELOG.md            Keep a Changelog 形式
CLAUDE.md               リポジトリ固有の AI 向け指示
```

## ランタイムデータレイアウト

cmux-msg が起動時に作る `~/.local/share/cmux-messages/` 配下の構造は `docs/design/data-layout-{root,session}.md` に詳細を記述。これらはランタイムで `.docs/v<version>/` にコピーされ、各階層の `README.md` が symlink で参照する。

`<base>/<sid>/` 直接構造 (DR-0004)。cwd / repo / claude_home / tags は `meta.json` の属性として記録される。

## docs 構成について

このリポジトリは kawaz/* 横断の docs 構造ルール (`~/.claude/rules/docs-structure.md`) の参考実装。命名規則・サブディレクトリ採用条件・言語ポリシー (ja 原本 + 英訳) などはそちらを参照。本セッションでの議論経緯は `docs/journal/2026-05-08-docs-structure-and-design-priority.md`。
