# cmux-msg スキル

cmux（libghosttyベースのターミナル）上で複数の Claude Code セッションがファイルベースでメッセージをやり取りするシステム。

## 前提条件

- cmux ターミナル上で実行されていること（`CMUX_WORKSPACE_ID` 環境変数が設定済み）
- SessionStart フックにより自動的に初期化される

## コマンド一覧

### ライフサイクル管理

```bash
# 新しいペインで子CCを起動（色は自動ローテーション）
# 初回は上にsplit、以降は最後の子の右にsplit
cmux-msg spawn [name] [--args claude-args]

# 子CCを終了
cmux-msg stop <surface_ref>
```

### メッセージング

```bash
# 自分のID情報を確認
cmux-msg whoami

# 同一ワークスペースのピア一覧
cmux-msg peers

# メッセージ送信
cmux-msg send <surface_id> <メッセージ>

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

# inbox を監視（シグナルベース、デフォルト60秒）
cmux-msg watch [timeout]
```

### ダイレクト操作

```bash
# 対象ペインに直接テキスト入力（メッセージシステム外）
cmux-msg tell <surface_ref> <テキスト>

# 対象ペインの画面内容を読み取り
cmux-msg screen [surface_ref]
```

## ワークフロー例

### 親CC（タスク依頼側）

1. `cmux-msg spawn worker-a` でワーカーを起動
2. spawn 完了後の surface_ref を記録
3. `cmux-msg send <worker_surface> "src/foo.ts のリファクタリングをしてください"` で指示
4. `cmux-msg watch` で返信を待つ
5. 返信が来たら `cmux-msg list` → `cmux-msg read <file>` で確認

### 複数ワーカーの並列起動

spawn は起動待ちで約30秒かかるため、複数ワーカーを起動する場合はバックグラウンドで並列実行すること:

```bash
# 良い例: 並列起動（Bash をバックグラウンドで実行）
cmux-msg spawn "task-A" &
cmux-msg spawn "task-B" &
cmux-msg spawn "task-C" &
wait
```

直列に実行すると N × 30秒 かかるので避ける。

### 子CC（ワーカー側）

1. SessionStart フックで自動初期化
2. `cmux-msg list` で inbox を確認
3. `cmux-msg read <file>` でタスク内容確認
4. `cmux-msg accept <file>` で受理
5. 作業実施
6. `cmux-msg reply <file> "完了しました。変更内容: ..."` で結果報告

## 環境変数

| 変数 | 説明 |
|------|------|
| `CMUX_WORKSPACE_ID` | cmux ワークスペースID（自動設定） |
| `CMUX_SURFACE_ID` | cmux サーフェスID（自動設定） |
| `CMUX_TAB_ID` | cmux タブID（自動設定） |
| `CMUX_MSG_BASE` | メッセージ保存先（デフォルト: `~/.local/share/cmux-messages`） |
| `CMUX_MSG_PRIORITY` | `urgent` を指定すると緊急メッセージとして送信 |
| `CMUX_MSG_PARENT_SURFACE` | spawn 時に自動設定される親のsurface ID |
| `CMUX_MSG_WORKER_NAME` | spawn 時に自動設定されるワーカー名 |

## メッセージ形式

メッセージは frontmatter 付き Markdown ファイル:

```markdown
---
from: surface:5
to: surface:8
type: request
priority: normal
created_at: 2026-03-25T14:30:00
---

ここにメッセージ本文
```

## ディレクトリ構造

```
~/.local/share/cmux-messages/
  {workspace_id}/
    {surface_id}/
      inbox/      未読メッセージ
      accepted/   受理済み（作業中）
      archive/    完了・破棄済み
      tmp/        原子的書き込み用
      meta.json   セッション情報
      pid         生存確認用PID
```
