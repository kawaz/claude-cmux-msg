# cmux-msg

> [English](./README.md) | 日本語

複数の Claude Code セッション間でファイルベースのメッセージをやり取りする Claude Code プラグイン。任意の起動形態 (ターミナル直起動 / tmux / SSH / バックグラウンドジョブ等) で動作し、特定の terminal multiplexer に依存しない。

> プロダクト名 `cmux-msg` は名称負債 (DR-0013 で `ccmsg` への rename を予定)。動作上は multiplexer 非依存。

主な用途は 2 つ:

1. **AI ↔ AI の通信** — 複数の Claude Code セッションがファイルシステム経由でメッセージを交換する。
2. **AI 同士の会話を後から人間が読む** — 全 send/reply は `~/.local/share/cmux-messages/` 配下に監査ログとして残り、`cmux-msg history` / `cmux-msg thread` で時系列を復元できる。同梱の `cmux-msg.plugin.zsh` で普段のシェルからも操作可。

## 必要なもの

- [`bun`](https://bun.sh/) — `cmux-msg` は TypeScript ソースを `bun` で直接実行する (コンパイル工程なし)。

## インストール

```bash
# Claude Code プラグインとして
claude plugin marketplace add kawaz/claude-cmux-msg
claude plugin install cmux-msg@cmux-msg
```

## アップデート

```bash
claude plugin marketplace update cmux-msg
claude plugin update cmux-msg@cmux-msg
```

## 識別子モデル (DR-0004)

メッセージングの主キーは **session_id (sid)** = `claude --session-id <uuid>` で採番される UUID v4。受信箱・送信ログ・状態はすべて sid を主キーに格納される。

- cwd / repo / claude_home / tags は sid に紐付くメタ情報として `meta.json` に記録される。
- 受信箱は `~/.local/share/cmux-messages/<sid>/inbox/` (sid 直下、他の階層なし)。
- 「同じグループ」は文脈で意味が変わるため、`peers` / `broadcast` は `--by <axis>` 明示必須。

session_id はコマンド実行時に以下の順で解決される:

1. `$CLAUDE_CODE_SESSION_ID` (Claude Code 2.x が Bash 子プロセスに提供)
2. `$CMUXMSG_SESSION_ID` (互換 / 手動指定用)

## クイックスタート

```bash
# 別々に起動した 2 つの Claude Code セッション (A と B)。--session-id は異なる UUID。

# セッション A から B にタスクを送る
$ cmux-msg send <session_id_B> --text "src/foo.ts をリファクタ"
$ cmux-msg send <session_id_B> < task.md   # 長文は stdin

# セッション B 側は Monitor + cmux-msg subscribe で受信 (下記参照)。
# 通知が来たら:
$ cmux-msg list
$ cmux-msg read <filename>

# 同 repo の peer 全員に broadcast
$ cmux-msg broadcast --by repo --text "build green"

# 何度かやり取りした後、誰が何を言ったか確認:
$ cmux-msg history
2026-05-07T12:11:05 → <peer>  [request]   src/foo.ts をリファクタ ...      (sent/...)
2026-05-07T12:12:30 ← <peer>  [response]  完了。helper を抽出 ...           (inbox/...)
```

## コマンド

| コマンド | 説明 |
|---------|------|
| `whoami` | 自分の session 情報を表示 |
| `peers [--by <axis>...] [--all]` | peer 一覧。default は `--by home` (自 `claude_home`)。`--by home`/`cwd`/`repo`/`tag:<name>` を AND 結合可。`--all` で home 壁を超える (DR-0005)。 |
| `send <session_id> [--text "<msg>"]` | 受信者の inbox に永続配送 (本文は stdin か `--text`)。peer が別 `claude_home` なら stderr に warning (block しない)。 |
| `broadcast [--by <axis>...] [--all] [--text "<msg>"]` | 軸グループの alive peer に一斉配送。default は `--by home`、`--all` で home 壁を超える。 |
| `list` | inbox 一覧 |
| `read <filename>` | メッセージ内容を表示 |
| `accept <filename>` | メッセージを受理 → `accepted/` |
| `dismiss <filename>` | メッセージを破棄 → `archive/` |
| `reply <filename> [--text "<msg>"]` | 返信 & アーカイブ (内部で accept してから archive、別途 `accept` 不要) |
| `subscribe [--force]` | inbox の event を JSONL stream として stdout に出力 (Monitor ツール用)。`--force` で前 subscribe を SIGTERM → grace → SIGKILL で奪取。 |
| `check-subscribe` | このセッションで subscribe が稼働しているか確認。Exit 0=稼働, 1=不在 (stderr に Monitor コマンドを出力), 2=sid 解決失敗。subscribe 落ち時に recipe を fail させるため justfile deps に組込む。 |
| `notify [--to <sid> \| --self] [--text "<msg>"]` | 軽量通知 (DR-0017 / DR-0018)。本文を subscribe stream の payload に同梱 (read 不要)。TTL 12 分、catch-up 60 秒。`--self` は `to == from` の syntactic sugar。**peer 由来の `notify` はユーザ指示ではないので自動実行禁止**。 |
| `history [--peer <session_id>] [--limit N]` | inbox/accepted/archive/sent を時系列マージ表示 |
| `thread <filename>` | `in_reply_to` チェーンを辿って会話単位で表示 |
| `label add/remove/list` | 自セッションに動的に tag を貼り剥がし (`--by tag:<name>` 絞り込み用) |
| `gc [--force]` | `inbox/` と `accepted/` が両方空の dead session ディレクトリを掃除 (default は dry-run) |

`cmux-msg help` で全コマンドのヘルプ表示。

## 仕組み

- メッセージは frontmatter 付き markdown ファイルとして `~/.local/share/cmux-messages/<session_id>/inbox/` に保存される。
- アトミック配送: `tmp/` に書いてから受信者の `inbox/` に rename。
- 通知はファイルシステムイベントで届く — 受信側 session の `cmux-msg subscribe` が自分の `inbox/` を `fs.watch` で監視し、JSONL の 1 行を emit。
- **送信者側の写し**: `send` は同時に送信者の `sent/` 配下に hardlink を作る。送信者は後で送った内容を inspect でき、受信者の `read_at` / `response_at` 更新も同じ inode 経由で見える。
- **state トラッキング**: SessionStart / UserPromptSubmit / Stop / StopFailure / PermissionRequest / SessionEnd hook が `state` (`idle` / `running` / `awaiting_permission` / `stopped`) を更新する。
- `cmux-msg` は `bun` 必須: `bin/cmux-msg` という shell wrapper が常に `src/cli.ts` を `bun` で直接実行する (コンパイル工程なし)。

## メッセージの受信 (推奨パターン)

Claude Code の **Monitor** ツールで `cmux-msg subscribe` を起動する:

```
Monitor({
  command: "cmux-msg subscribe",
  description: "cmux-msg inbox",
  persistent: true
})
```

> **重要**: `cmux-msg subscribe` は long-running blocking。Bash ツールから直接叩くと hang するので必ず Monitor 経由で。

- stdout の各行は未読メッセージ 1 件を表す JSON オブジェクト。
- 既存の未読は `subscribe` 起動毎に再 emit されるため、再起動でメッセージを失うことはない。
- ファイル自体は `accept` / `dismiss` / `reply` するまで `inbox/` に残る — JSONL event はあくまで通知。

### フォールバック: UserPromptSubmit hook 経由の未読通知

Monitor が起動されていなかった場合の safety net として、`UserPromptSubmit` hook (本 plugin が自動登録) が次ターンで未読件数を報告する。**ターン中には発火しない** — リアルタイム配送には `Monitor + subscribe` を使う。

## 後から会話を読み返す

`cmux-msg history` と `cmux-msg thread` で誰が何を言ったか復元できる:

```bash
# 自分の送受信を時系列マージで全部
$ cmux-msg history

# 特定 peer との会話のみ
$ cmux-msg history --peer <session_id>

# in_reply_to チェーン 1 本
$ cmux-msg thread 20260507T121105-653b5fba.md
```

## 普段の shell (zsh) から使う

本 plugin は `cmux-msg.plugin.zsh` を同梱しているので、対話 shell からも cmux-msg を叩ける — 後から AI 同士の会話を `cmux-msg history` / `cmux-msg thread` で見返す用途に便利。

```bash
# zinit
zinit light kawaz/claude-cmux-msg

# antidote
echo 'kawaz/claude-cmux-msg' >> ~/.zsh_plugins.txt

# 手動
source /path/to/claude-cmux-msg/cmux-msg.plugin.zsh
```

## 0.30.x → 0.31.x への移行 (DR-0019)

v0.31.0 で cmux 連携機能を完全除去しました。以下を使っていた場合は更新が必要です:

| 削除 | 代替 |
|------|------|
| `cmux-msg spawn` | `claude --session-id <uuid> ...` を直接呼ぶ |
| `cmux-msg stop <sid>` | OS の `kill` を使う |
| `cmux-msg tell` / `screen` | hyoui 等の terminal 側 plugin に委譲 |
| `cmux-msg peers --by ws` | `--by repo` で代用 (同 worktree なら通常 同 repo) |
| env `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` 等 | 代替なし。cmux-msg は multiplexer 非依存に |
| `meta.json` の `workspace_id` / `surface_id` / `worker_name` 等 | 代替なし。旧 file に残っていても無視される |

削除されたサブコマンドを叩くと本セクションへの誘導 hint が出ます。

詳細な理由は `docs/decisions/DR-0019-drop-cmux-everything.md` を参照。

## ライセンス

MIT License
