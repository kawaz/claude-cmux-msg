# claude セッションのメッセージ箱

このディレクトリは **1 つの claude セッション**（`claude --session-id <uuid>`
で採番された UUID 単位）が受け取ったメッセージを保管する場所。

ディレクトリ名 `<session_id>` は UUID v4（小文字）。`cmux-msg whoami` で
自分の session_id を確認できる。

## 階層構造

```
<session_id>/                        ← ここ (1 セッション分)
├── README.md                        ← この文書
├── inbox/                           ← 受信したが未処理のメッセージ
│   └── <yyyyMMddTHHmmss>-<rand8>.md
├── accepted/                        ← `cmux-msg accept` 処理済み (返信可能)
├── archive/                         ← `cmux-msg dismiss` / `reply` 後の保管庫
├── tmp/                             ← 配送中の一時ファイル (rename で原子的配送)
├── pid                              ← セッションのシェル PID (生存確認用)
└── meta.json                        ← session_id, workspace_id, surface_id 等
```

## メッセージファイル

各メッセージは Markdown + YAML フロントマター:

```markdown
---
from: <送信元 session_id>
to: <宛先 session_id>
type: request | response | broadcast
priority: normal | urgent
created_at: <ISO8601>
in_reply_to: <返信元 filename> (optional)
read_at: <accept/dismiss/reply 時刻> (optional)
response_at: <reply 時刻> (optional)
archive_at: <archive 移動時刻> (optional)
---

本文…
```

## 操作の流れ

```
              cmux-msg send / broadcast
他セッション ─────────────────────────→ inbox/
                                          │
                              cmux-msg accept │ cmux-msg dismiss
                                          ▼   ▼
                                     accepted/  archive/
                                          │
                                cmux-msg reply ───→ archive/
                                                    (+ 相手の inbox に返信)
```

`cmux-msg list` で inbox 一覧、`cmux-msg read <filename>` で内容を確認できる。
