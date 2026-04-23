# cmux-msg スキル

cmux（libghosttyベースのターミナル）上で複数の Claude Code セッションがファイルベースでメッセージをやり取りするシステム。

## 識別子

**全コマンドの宛先指定は claude session UUID（`CMUXMSG_SESSION_ID` の値）を使う**。
これは `claude --session-id <uuid>` で採番された UUID v4。spawn は親が UUID を先行生成して子に渡すので、親は即座に子の id を知れる（polling 不要）。

形式は `1d033978-acf7-479b-b355-160ec85217b1` のような UUID v4。

`cmux-msg peers` で同一ワークスペースのピア一覧と各 session_id を確認できる。

## 前提条件

- cmux ターミナル上で実行されていること（`CMUX_WORKSPACE_ID` 環境変数が設定済み）
- claude が `--session-id` 付きで起動されていること（spawn 経由なら自動）
- SessionStart フックが `CMUXMSG_SESSION_ID` を `$CLAUDE_ENV_FILE` に export → 以降のシェルで利用可能

## コマンド一覧

### ライフサイクル管理

```bash
# 新しいペインで子CCを起動
# 初回は上にsplit、以降は最後の子の右にsplit。色は自動ローテーション。
# spawn 完了時の出力例:
#   spawn完了: id=1d033978-acf7-479b-b355-160ec85217b1 name=worker-1 color=red
cmux-msg spawn [name] [--cwd path] [--args claude-args]

# 子CCを終了（session_id で指定）
cmux-msg stop <session_id>
```

### メッセージング

```bash
# 自分のID情報を確認
cmux-msg whoami

# 同一ワークスペースのピア一覧
# 出力例: 1d033978-acf7-479b-b355-160ec85217b1  alive  name=worker-1
cmux-msg peers

# メッセージ送信（session_id 指定）
cmux-msg send <session_id> <メッセージ>

# 全ピアにブロードキャスト
cmux-msg broadcast <メッセージ>

# inbox のメッセージ一覧
cmux-msg list

# メッセージ内容を表示
cmux-msg read <filename>

# メッセージを受理して作業開始
cmux-msg accept <filename>

# メッセージを破棄（作業不要）
cmux-msg dismiss <filename>

# 返信送信 & アーカイブ
cmux-msg reply <filename> <返信内容>

# inbox 新着を JSONL で連続出力（永続ループ、Monitor 用）
cmux-msg subscribe
```

### subscribe の使い方（Monitor ツール前提）

Claude Code の Monitor ツールで `cmux-msg subscribe` を張ると、新着メッセージが
JSONL 1 行 = 1 イベントとして通知される。

```
Monitor({
  command: "cmux-msg subscribe",
  description: "cmux-msg inbox",
  persistent: true
})
```

- 起動時に既存未読を全件 emit するので、セッション resume 後の張り直しでも取りこぼし無し
- 各イベントは `{filename, from, priority, type, created_at, in_reply_to}` の JSON
- 本文は `cmux-msg read <filename>` で取得（JSONL には含めない）
- メッセージは `accept` / `dismiss` / `reply` するまで inbox に残るため、再起動時は再通知される

### ダイレクト操作

```bash
# 対象ペインに直接テキスト入力（メッセージシステム外）
cmux-msg tell <session_id> <テキスト>

# 対象ペインの画面内容を読み取り
cmux-msg screen [session_id]
```

## ワークフロー例

### 親CC（タスク依頼側）

1. Monitor ツールで `cmux-msg subscribe` を張る（persistent: true）
2. `cmux-msg spawn worker-a --cwd /path/to/project` でワーカーを起動
3. spawn 出力の `id=<session_id>` を記録（親が UUID を先行生成しているので即時確定）
4. `cmux-msg send <session_id> "src/foo.ts のリファクタリングをしてください"` で指示
5. Monitor の通知で返信が届いたら `cmux-msg read <file>` で確認

### 複数ワーカーの並列起動

spawn は起動待ちで約30秒かかるため、複数ワーカーを起動する場合はバックグラウンドで並列実行すること:

```bash
# 良い例: 並列起動（Bash をバックグラウンドで実行）
cmux-msg spawn "task-A" --cwd /path/A &
cmux-msg spawn "task-B" --cwd /path/B &
cmux-msg spawn "task-C" --cwd /path/C &
wait
```

直列に実行すると N × 30秒 かかるので避ける。

### 子CC（ワーカー側）

1. SessionStart フックで自動初期化
2. Monitor ツールで `cmux-msg subscribe` を張る（persistent: true）
3. 通知が来たら `cmux-msg read <filename>` でタスク内容確認
4. `cmux-msg accept <filename>` で受理
5. 作業実施
6. `cmux-msg reply <filename> "完了しました。変更内容: ..."` で結果報告
7. 次の通知を待つ（Monitor に任せて他の作業を並行してよい）
8. resume された場合は Monitor を張り直す（subscribe が既存未読を再通知する）

## 環境変数

| 変数 | 説明 |
|------|------|
| `CMUX_WORKSPACE_ID` | cmux ワークスペースID（自動設定） |
| `CMUXMSG_SESSION_ID` | claude session UUID。SessionStart hook が自動で export |
| `CMUX_TAB_ID` | cmux タブID（自動設定） |
| `CMUXMSG_BASE` | メッセージ保存先（デフォルト: `~/.local/share/cmux-messages`） |
| `CMUXMSG_PRIORITY` | `urgent` を指定すると緊急メッセージとして送信 |
| `CMUXMSG_PARENT_SESSION_ID` | spawn 時に自動設定される親の session_id |
| `CMUXMSG_WORKER_NAME` | spawn 時に自動設定されるワーカー名 |
| `CMUXMSG_SURFACE_REF` | spawn 時に自動設定される cmux 内部参照（surface:N） |

## メッセージ形式

メッセージは frontmatter 付き Markdown ファイル。`from`/`to` は session_id:

```markdown
---
from: 77931c63-8f8e-46ec-858a-6956366fe34f
to: 1d033978-acf7-479b-b355-160ec85217b1
type: request
priority: normal
created_at: 2026-04-13T14:30:00
---

ここにメッセージ本文
```

## ディレクトリ構造

```
~/.local/share/cmux-messages/
  {workspace_id}/
    {session_id}/
      inbox/      未読メッセージ
      accepted/   受理済み（作業中）
      archive/    完了・破棄済み
      tmp/        原子的書き込み用
      meta.json   セッション情報（session_id, surface_ref, worker_name 等）
      pid         生存確認用PID
```

peer の `surface_ref` が必要な場面（tell / screen / stop）は、peer の `meta.json` を直接読んで解決する。共有ファイルは持たない。
