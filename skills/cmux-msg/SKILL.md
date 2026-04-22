# cmux-msg スキル

cmux（libghosttyベースのターミナル）上で複数の Claude Code セッションがファイルベースでメッセージをやり取りするシステム。

## 識別子

**全コマンドの宛先指定は UUID（`CMUX_SURFACE_ID` の値）を使う**。
形式は `1D033978-ACF7-479B-B355-160EC85217B1` のような UUID v4。

`cmux-msg peers` で同一ワークスペースのピア一覧と各 UUID を確認できる。

## 前提条件

- cmux ターミナル上で実行されていること（`CMUX_WORKSPACE_ID` 環境変数が設定済み）
- SessionStart フックにより自動的に初期化される

## コマンド一覧

### ライフサイクル管理

```bash
# 新しいペインで子CCを起動
# 初回は上にsplit、以降は最後の子の右にsplit。色は自動ローテーション。
# spawn 完了時の出力例:
#   spawn完了: id=1D033978-ACF7-479B-B355-160EC85217B1 name=worker-1 color=red
cmux-msg spawn [name] [--cwd path] [--args claude-args]

# 子CCを終了（UUID で指定）
cmux-msg stop <uuid>
```

### メッセージング

```bash
# 自分のID情報を確認
cmux-msg whoami

# 同一ワークスペースのピア一覧
# 出力例: 1D033978-ACF7-479B-B355-160EC85217B1  alive  name=worker-1
cmux-msg peers

# メッセージ送信（UUID 指定）
cmux-msg send <uuid> <メッセージ>

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
cmux-msg tell <uuid> <テキスト>

# 対象ペインの画面内容を読み取り
cmux-msg screen [uuid]
```

## ワークフロー例

### 親CC（タスク依頼側）

1. Monitor ツールで `cmux-msg subscribe` を張る（persistent: true）
2. `cmux-msg spawn worker-a --cwd /path/to/project` でワーカーを起動
3. spawn 出力の `id=<UUID>` を記録
4. `cmux-msg send <UUID> "src/foo.ts のリファクタリングをしてください"` で指示
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
| `CMUX_SURFACE_ID` | cmux サーフェスID（UUID、自動設定） |
| `CMUX_TAB_ID` | cmux タブID（自動設定） |
| `CMUX_MSG_BASE` | メッセージ保存先（デフォルト: `~/.local/share/cmux-messages`） |
| `CMUX_MSG_PRIORITY` | `urgent` を指定すると緊急メッセージとして送信 |
| `CMUX_MSG_PARENT_SURFACE` | spawn 時に自動設定される親の UUID |
| `CMUX_MSG_WORKER_NAME` | spawn 時に自動設定されるワーカー名 |
| `CMUX_MSG_SURFACE_REF` | spawn 時に自動設定される cmux 内部参照（surface:N） |

## メッセージ形式

メッセージは frontmatter 付き Markdown ファイル。`from`/`to` は UUID:

```markdown
---
from: 77931C63-8F8E-46EC-858A-6956366FE34F
to: 1D033978-ACF7-479B-B355-160EC85217B1
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
    {surface_uuid}/
      inbox/      未読メッセージ
      accepted/   受理済み（作業中）
      archive/    完了・破棄済み
      tmp/        原子的書き込み用
      meta.json   セッション情報（worker_name 等含む）
      pid         生存確認用PID
    surface-refs.json   UUID → cmux 内部参照（surface:N）マッピング
```
