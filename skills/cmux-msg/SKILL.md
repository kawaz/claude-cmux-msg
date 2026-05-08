# cmux-msg スキル

cmux（libghosttyベースのターミナル）上で複数の Claude Code セッションがファイルベースでメッセージをやり取りするシステム。

## 識別子

**全コマンドの宛先指定は claude session UUID（`CMUXMSG_SESSION_ID` の値）を使う**。
これは `claude --session-id <uuid>` で採番された UUID v4。spawn は親が UUID を先行生成して子に渡すので、親は即座に子の id を知れる（polling 不要）。

形式は `1d033978-acf7-479b-b355-160ec85217b1` のような UUID v4。

`cmux-msg peers` で同一ワークスペースのピア一覧と各 session_id を確認できる。

## 前提条件

- cmux ターミナル上で実行されていること（`CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` 環境変数が設定済み）
- claude が `--session-id` 付きで起動されていること（spawn 経由なら自動）
- SessionStart フックが `<ws>/by-surface/<CMUX_SURFACE_ID>` に session_id を書く
  → cmux-msg コマンドはここから session_id を逆引きする（env 伝播は claude-code Issue #15840 で機能しないため）

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

# 同一ワークスペースのピア一覧 (既定は alive のみ)
# 出力例: 1d033978-acf7-479b-b355-160ec85217b1  alive  name=worker-1
cmux-msg peers
# dead セッションも含めて全件表示
cmux-msg peers --all

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

# 自分が関わった全メッセージを時系列マージ表示
# 送信(sent/) と 受信(inbox/accepted/archive/) を一緒に時系列で見られる
cmux-msg history [--peer <session_id>] [--limit N]

# in_reply_to を遡る/前方探索して会話単位で表示
cmux-msg thread <filename>

# dead な過去セッションのディレクトリを掃除 (inbox/accepted が空のもののみ)
# 既定 dry-run、--force で実行。archive/sent も一緒に削除されるので注意。
cmux-msg gc [--force]
```

### subscribe の使い方（Monitor ツール前提）

**重要**: `cmux-msg subscribe` は long-running blocking command。Bash ツールで直接実行するとハングする。**必ず Monitor ツール経由で起動すること**。

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

### history / thread の使い方

`cmux-msg history` は inbox/accepted/archive/sent を横断して時系列マージで表示する。
出力 1 行 = 1 メッセージ:

```
2026-05-07T12:11:05 → 86a102a3  [request]   春のキャッチコピー3案を…  (sent/20260507T121105-653b5fba.md)
2026-05-07T12:11:21 ← 86a102a3  [response]  評価（5段階）: …  (inbox/20260507T121121-27470a60.md)
```

`→` が送信、`←` が受信。`--peer <session_id>` で相手単位、`--limit N` で件数制限。

`cmux-msg thread <filename>` は `in_reply_to` を遡り/前方探索して会話単位で表示。
特定メッセージから派生したやりとりだけを抜き出して読める。

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
4. 作業実施
5. `cmux-msg reply <filename> "完了しました。変更内容: ..."` で結果報告
   - reply は内部で accept してから archive に移すので、別途 `cmux-msg accept` は不要
   - 返信不要なメッセージは `cmux-msg dismiss <filename>` で archive へ
6. 次の通知を待つ（Monitor に任せて他の作業を並行してよい）
7. resume された場合は Monitor を張り直す（subscribe が既存未読を再通知する）

## 環境変数

| 変数 | 説明 |
|------|------|
| `CMUX_WORKSPACE_ID` | cmux ワークスペースID（自動設定） |
| `CMUX_SURFACE_ID` | cmux surface UUID（自動設定）。session_id 逆引きの起点 |
| `CMUXMSG_SESSION_ID` | claude session UUID。CLAUDE_ENV_FILE バグで通常は空、by-surface 経由で逆引きされる |
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
  README.md                        # 「ここは何の場所か」(.docs/latest/data-layout-root.md への symlink)
  .docs/v<version>/                # plugin の docs/design/ から SessionStart hook がコピー
  .docs/latest                     # → v<version> (バージョン bump で付け替え)
  {workspace_id}/
    README.md                      # ワークスペース階層の説明 (symlink)
    by-surface/{surface_uuid}      # 中身=session_id (1行)。getSessionId が逆引きに使う
    {session_id}/
      README.md                    # セッション階層の説明 (symlink)
      inbox/                       # 未読メッセージ
      accepted/                    # 受理済み（作業中）
      archive/                     # 完了・破棄済み
      sent/                        # 自分が送信したメッセージ (相手の inbox と hardlink で同実体)
      tmp/                         # 原子的書き込み用
      meta.json                    # セッション情報（session_id, surface_id, surface_ref, worker_name 等）
      pid                          # 生存確認用PID
```

各階層の `README.md` は plugin から自動配置される symlink。直接ファイルを覗いた時に
「ここは何の場所か」がすぐ分かる。

peer の `surface_ref` が必要な場面（tell / screen / stop）は、peer の `meta.json` を直接読んで解決する。共有ファイルは持たない（by-surface は session_id 逆引きのみ）。

`sent/` は送信側にも記録を残す。peer の `inbox/<filename>` と同じ inode を hardlink
で共有しているため:
- 受信側で frontmatter (read_at / response_at / archive_at) が追記されると送信側
  からも処理状況が見える
- 受信側が rename (inbox→accepted/archive) しても inode 不変で sent/ からは常に
  読める

**inode 共有の前提が崩れるケース** (sent/ から見える内容が古くなる可能性):
- 受信側がエディタで保存する際、atomic save (tmp → rename) で書く実装だと inode
  が別物に置き換わる。cmux-msg のコマンド経由 (accept/dismiss/reply) は in-place
  書き換え + rename しか行わないため、通常は inode 不変
- 受信側が `rm` で削除した場合: hardlink なので sent/ 側のリンクは残り、内容も
  そのまま読める (削除された側だけ消える)
- 別ファイルシステム (NFS / tmpfs 越え) では `link()` 不可。0.15.0 以降は
  fallback でコピーを作らず、stderr に warning を出して sent/ への記録を諦める

`cmux-msg history` は sent/ と inbox/accepted/archive/ を時系列マージで表示するので、
**自分のセッションディレクトリだけ見れば「自分が送ったもの + 受け取ったもの」が
一目で追える**。
