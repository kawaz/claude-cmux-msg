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

## 識別子モデル (DR-0004)

メッセージングの主体は **session_id (sid)**。`claude --session-id <uuid>` で採番された UUID v4 を、すべての受信箱・送信履歴・状態の主キーに使う。

- workspace / surface / cwd / repo / claude_home / tags は sid に紐付くメタ情報として `meta.json` に記録され、ディレクトリ階層には含まれない
- 受信箱は `~/.local/share/cmux-messages/<sid>/inbox/` (sid 直接、workspace 階層なし)
- 「同じグループ」の定義はユースケースによって違うので、`peers` / `broadcast` は `--by <axis>` で軸を明示する

session_id はコマンド実行時に以下の順で解決される:

1. `$CLAUDE_CODE_SESSION_ID` (Claude Code 2.x で Bash 子プロセスに渡される)
2. `$CMUXMSG_SESSION_ID` (互換 / 手動設定用)
3. `<base>/by-surface/<CMUX_SURFACE_ID>` を引く (SessionStart hook が書き込む。CLAUDE_ENV_FILE バグ Issue #15840 回避)

## クイックスタート

```bash
# 親 CC のペインで: /path/to/project にワーカーを spawn
$ cmux-msg spawn worker-a --cwd /path/to/project
spawn完了: id=1d033978-acf7-479b-b355-160ec85217b1 name=worker-a color=red

# ワーカーにタスクを送る (永続)
$ cmux-msg send 1d033978-acf7-479b-b355-160ec85217b1 "src/foo.ts をリファクタしてください"

# 返信は Monitor + cmux-msg subscribe で受ける (後述)
# 通知が来たら:
$ cmux-msg list
$ cmux-msg read <filename>

# 同じ repo の peer 全員に broadcast
$ cmux-msg broadcast --by repo "build 通った"

# 何往復かしたあとで、自分とワーカーが何を話したかを見る:
$ cmux-msg history
2026-05-07T12:11:05 → 1d033978  [request]   src/foo.ts をリファクタ ...           (sent/...)
2026-05-07T12:12:30 ← 1d033978  [response]  完了。helper を抽出 ...   (inbox/...)

# 完了したらワーカーを停止
$ cmux-msg stop 1d033978-acf7-479b-b355-160ec85217b1
```

## コマンド一覧

| コマンド | 説明 |
|---------|-------------|
| `spawn [name] [--cwd path] [--args claude-args] [--tags csv]` | 新しい split pane に子 CC を spawn。`--tags csv` で子の `meta.tags` を初期化 |
| `stop <session_id>` | 子 CC を終了してペインを閉じる |
| `whoami` | 自分のセッション情報を表示 |
| `peers [--by <axis>...] [--all]` | peer 一覧。軸なしは `--by home` (自 `claude_home`)。`--by home`/`ws`/`cwd`/`repo`/`tag:<name>` を AND 結合、`--all` で全 home 横断 (DR-0005) |
| `send <session_id> <message>` | メッセージを inbox に永続配送。peer が別 `claude_home` の場合は stderr に warning (block しない) |
| `broadcast [--by <axis>...] [--all] <message>` | 軸で絞り込んだ alive peer にブロードキャスト。軸なしは `--by home`、`--all` で全 home 横断 |
| `list` | inbox のメッセージ一覧 |
| `read <filename>` | メッセージ内容を表示 |
| `accept <filename>` | メッセージを受理（→ `accepted/`） |
| `dismiss <filename>` | メッセージを破棄（→ `archive/`） |
| `reply <filename> <body>` | 返信送信 & アーカイブ（内部で accept するので別途 `accept` 不要） |
| `subscribe` | inbox イベントを JSONL で stdout に流す（Monitor 用） |
| `history [--peer <session_id>] [--limit N]` | inbox/accepted/archive/sent をマージして時系列表示 |
| `thread <filename>` | `in_reply_to` を遡る/前方探索して会話を表示 |
| `tell <session_id> <text>` | ペインに直接テキスト入力。fg + state ∈ {idle, awaiting_permission} 必須 (DR-0004) |
| `screen [session_id]` | ペインの画面内容を読む。fg 必須 |
| `gc [--force]` | inbox/accepted が両方空の dead session を掃除（既定 dry-run） |

`cmux-msg help` で完全なヘルプを表示。

## 仕組み

- メッセージは frontmatter 付き Markdown ファイルとして `~/.local/share/cmux-messages/<session_id>/inbox/` に保存される
- 配送は `tmp/` に書いてから受信者の `inbox/` に rename することで原子的
- 通知は `cmux wait-for` シグナル（`cmux-msg:<session_id>`）
- **送信側のコピー**: `send` は送信側の `sent/` ディレクトリにも hardlink を作るため、後から自分が何を送ったかを確認できる（受信側の `read_at` / `response_at` 更新も同じ inode を共有して見える）
- **状態トラッキング**: SessionStart / UserPromptSubmit / Stop / StopFailure / PermissionRequest / SessionEnd hook が `state` (`idle` / `running` / `awaiting_permission` / `stopped`) を更新する。`tell` はこれを参照して安全な時のみ入力を流す
- spawn されたワーカーは SessionStart hook で自動初期化される。`bin/cmux-msg-bin`（コンパイル成果物）も初回起動時に自動ビルド。シェルラッパーの `bin/cmux-msg` はコンパイル成果物がない時 `bun run src/cli.ts` にフォールバック
- SessionStart hook は `<base>/by-surface/<CMUX_SURFACE_ID>` に session_id を書き込む。env 伝播なしで session_id を逆引きできる
- 同じ workspace 内のピアは互いに信頼するモデル: `spawn` は `--add-dir <MSG_BASE>` を渡すため、子 CC は互いの inbox/sent 等を読み書きでき、サンドボックスの EPERM が起きない。脅威モデルは `docs/decisions/DR-0002-sandbox-and-peer-listing.md` を参照

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

- 各 stdout 行は 1 件の未読メッセージを表す JSON オブジェクト
- 既存の未読は `subscribe` 起動のたびに再 emit されるので、resume 後でも取りこぼし無し
- ファイル自体は `accept` / `dismiss` / `reply` するまで `inbox/` に残る — JSONL イベントは通知のみ

### 補完: UserPromptSubmit hook による未読通知

Monitor を張り忘れた場合の safety net として、`UserPromptSubmit` hook が新着メッセージを次のターンで通知する（プラグインが自動登録）。ターン**中**には発火しないため、リアルタイム通知が必要なら Monitor + `subscribe` のほうが確実。

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

`history` は `inbox/` `accepted/` `archive/` `sent/` を横断し `created_at` でソートする。各行に `→`（送信）または `←`（受信）を付ける。

## 並列 spawn

`spawn` は Claude プロンプトの出現を最大 30 秒待つ。複数ワーカーを直列の待ちなしで起動するには並列実行する:

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

## ライセンス

MIT License
