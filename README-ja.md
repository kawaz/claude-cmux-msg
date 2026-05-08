# cmux-msg

> [English](./README.md) | 日本語

[cmux](https://github.com/nichochar/cmux)（libghostty ベースのターミナル）のペイン上で動く複数の Claude Code セッション間に、ファイルベースのメッセージングを提供する Claude Code プラグイン。

主なユースケース 2 つ:

1. **AI ↔ AI 間の通信** — 親 CC が新しいペインにワーカー CC を spawn し、ファイルシステム経由でメッセージを交換する
2. **AI 同士の会話を後から人間が読む** — 全ての送受信は `~/.local/share/cmux-messages/` に監査ログとして残り、`cmux-msg history` / `cmux-msg thread` で会話の時系列を再構築できる。同梱の `cmux-msg.plugin.zsh` を使えば普段のシェルからも操作可能

## インストール

```bash
# Claude Code プラグインとして
claude plugin marketplace add kawaz/claude-cmux-msg
claude plugin install cmux-msg@cmux-msg
```

## 更新

```bash
claude plugin marketplace update cmux-msg
claude plugin update cmux-msg@cmux-msg
```

## 識別子

全てのコマンドは **claude session UUID**（`claude --session-id` の値）でピアを指定する。`spawn` は子の UUID を親側で先行生成して `claude --session-id <uuid>` を起動するため、親は即座に子の id を知れる（polling 不要）。

session_id はコマンド実行時に以下の順で解決される:

1. `$CMUXMSG_SESSION_ID`（Claude Code の `CLAUDE_ENV_FILE` メカニズムが将来動くようになった日のために残してある — Issue #15840）
2. **現状の動作経路**: `<ws>/by-surface/<CMUX_SURFACE_ID>` を引く（SessionStart hook が書き込む）

ピア一覧と各 session_id は `cmux-msg peers` で確認できる（既定は alive のみ、`--all` で dead も表示）。

## クイックスタート

```bash
# 親 CC のペインで: /path/to/project にワーカーを spawn
$ cmux-msg spawn worker-a --cwd /path/to/project
spawn完了: id=1d033978-acf7-479b-b355-160ec85217b1 name=worker-a color=red

# ワーカーにタスクを送る
$ cmux-msg send 1d033978-acf7-479b-b355-160ec85217b1 "src/foo.ts をリファクタしてください"

# 返信は Monitor + cmux-msg subscribe で受ける（後述）
# 通知が来たら:
$ cmux-msg list
$ cmux-msg read <filename>

# 何往復かしたあとで、自分とワーカーが何を話したかを見る:
$ cmux-msg history
2026-05-07T12:11:05 → 1d033978  [request]   src/foo.ts をリファクタ ...           (sent/...)
2026-05-07T12:12:30 ← 1d033978  [response]  完了。helper を抽出 ...   (inbox/...)

# 特定の thread (親 + 返信) だけ見たいとき
$ cmux-msg thread 20260507T121105-...md

# 完了したらワーカーを停止
$ cmux-msg stop 1d033978-acf7-479b-b355-160ec85217b1
```

## コマンド一覧

| コマンド | 説明 |
|---------|-------------|
| `spawn [name] [--cwd path] [--args claude-args]` | 新しい split pane に子 CC を spawn |
| `stop <session_id>` | 子 CC を終了してペインを閉じる |
| `whoami` | 自分のセッション情報を表示 |
| `peers [--all]` | 同じワークスペースのピア一覧（既定 alive のみ） |
| `send <session_id> <message>` | メッセージ送信 |
| `broadcast <message>` | 全ピアにブロードキャスト |
| `list` | inbox のメッセージ一覧 |
| `read <filename>` | メッセージ内容を表示 |
| `accept <filename>` | メッセージを受理（→ `accepted/`） |
| `dismiss <filename>` | メッセージを破棄（→ `archive/`） |
| `reply <filename> <body>` | 返信送信 & アーカイブ（内部で accept するので別途 `accept` 不要） |
| `subscribe` | inbox イベントを JSONL で stdout に流す（Monitor 用） |
| `history [--peer <session_id>] [--limit N]` | inbox/accepted/archive/sent をマージして時系列表示 |
| `thread <filename>` | `in_reply_to` を遡る/前方探索して会話を表示 |
| `tell <session_id> <text>` | ペインに直接テキスト入力（messaging 経由しない） |
| `screen [session_id]` | ペインの画面内容を読む |
| `gc [--force]` | `inbox/` と `accepted/` が両方空の dead session を掃除（既定 dry-run、`--force` で実削除。`archive/` と `sent/` も一緒に消える点に注意） |

`cmux-msg help` で完全なヘルプを表示。

## 仕組み

- メッセージは frontmatter 付き Markdown ファイルとして `~/.local/share/cmux-messages/<workspace>/<session_id>/inbox/` に保存される
- 配送は `tmp/` に書いてから受信者の `inbox/` に rename することで原子的
- 通知は `cmux wait-for` シグナル（`cmux-msg:<session_id>`）
- **送信側のコピー**: `send` は送信側の `sent/` ディレクトリにも hardlink を作るため、後から自分が何を送ったかを確認できる（受信側の `read_at` / `response_at` 更新も同じ inode を共有して見える）
- **各階層の README.md**: 各レイヤ（`~/.local/share/cmux-messages/`、`<workspace>/`、`<session>/`）に `.docs/latest/data-layout-*.md` を指す README.md (symlink) が貼られる。UUID 入れ子のディレクトリで `ls` した時に `cat README.md` でその階層が何かを思い出せる
- spawn されたワーカーは SessionStart hook で自動初期化される。`bin/cmux-msg-bin`（コンパイル成果物）も初回起動時に自動ビルド。シェルラッパーの `bin/cmux-msg` はコンパイル成果物がない時 `bun run src/cli.ts` にフォールバック
- SessionStart hook は `<ws>/by-surface/<CMUX_SURFACE_ID>` に session_id を書き込む。これにより以降の `cmux-msg` コマンドは env 伝播なしで session_id を逆引きできる（`$CLAUDE_ENV_FILE` も将来互換のため書くが、現在は依拠していない — Issue #15840）
- 同じ workspace 内のピアは互いに信頼するモデル: `spawn` は `--add-dir <MSG_BASE>/<workspace>` を渡すため、子 CC は互いの inbox/sent 等を読み書きでき、サンドボックスの EPERM が起きない。脅威モデルは `docs/decisions/DR-0002-sandbox-and-peer-listing.md` を参照

## メッセージ受信（推奨パターン）

Claude Code の **Monitor** ツールに `cmux-msg subscribe` を渡す:

```
Monitor({
  command: "cmux-msg subscribe",
  description: "cmux-msg inbox",
  persistent: true
})
```

> **重要**: `cmux-msg subscribe` は long-running な blocking command。Bash ツールから直接叩くとハングする。必ず Monitor 経由で起動すること。

- 各 stdout 行は 1 件の未読メッセージを表す JSON オブジェクト（`filename` / `from` / `priority` / `type` / `created_at` / `in_reply_to`）
- 既存の未読は `subscribe` 起動のたびに再 emit されるので、resume 後でも取りこぼし無し
- ファイル自体は `accept` / `dismiss` / `reply` するまで `inbox/` に残る — JSONL イベントは通知のみ

## 後から会話を読み返す

`cmux-msg history` と `cmux-msg thread` で会話を再構築する:

```bash
# 自分が関わった全メッセージを時系列マージ
$ cmux-msg history

# 特定ピアとの会話だけに絞る
$ cmux-msg history --peer 1d033978-acf7-479b-b355-160ec85217b1

# 1 つの in_reply_to チェーン
$ cmux-msg thread 20260507T121105-653b5fba.md
```

`history` は `inbox/` `accepted/` `archive/` `sent/` を横断し `created_at` でソートする。各行に `→`（送信）または `←`（受信）を付ける。`thread` は `in_reply_to` を親方向（遡及）と子方向（前方探索）の両方で辿る。

## 並列 spawn

`spawn` は Claude プロンプトの出現を最大 30 秒待つ（実際はもっと短い）。複数ワーカーを直列の待ちなしで起動するには並列実行する:

```bash
cmux-msg spawn task-a --cwd /path/A &
cmux-msg spawn task-b --cwd /path/B &
cmux-msg spawn task-c --cwd /path/C &
wait
```

## 普段のシェル (zsh) から使う

`cmux-msg.plugin.zsh` を同梱しているので、普段のシェルからも cmux-msg を叩ける — AI の会話を後から `cmux-msg history` / `cmux-msg thread` で読み返す用途に便利。

```bash
# zinit
zinit light kawaz/claude-cmux-msg

# antidote
echo 'kawaz/claude-cmux-msg' >> ~/.zsh_plugins.txt

# 手動
source /path/to/claude-cmux-msg/cmux-msg.plugin.zsh
```

このプラグインは同梱の `bin/cmux-msg` ラッパーへの alias を貼る（コンパイル成果物 `bin/cmux-msg-bin` があれば exec、なければ `bun run src/cli.ts` にフォールバック）。`completions/` も `fpath` に追加するので、サブコマンドとオプションのタブ補完が効く。

## ライセンス

MIT License
