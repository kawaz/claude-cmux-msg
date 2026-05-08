# cmux ワークスペースのメッセージ箱

このディレクトリは **1 つの cmux ワークスペース**（≒ ターミナルウィンドウ）に
属する Claude Code セッション全員のメッセージ箱を集めた場所。

ディレクトリ名 `<workspace_id>` は cmux が採番する UUID（大文字）。

## 階層構造

```
<workspace_id>/                      ← ここ
├── README.md                        ← この文書
├── <session_id>/                    ← claude セッション (UUID 小文字, claude --session-id で採番)
│   └── README.md                    ← その session のメッセージ箱の説明
├── by-surface/                      ← surface_id → session_id 逆引きインデックス
│   └── <surface:N>                  ← 中身は session_id の文字列
├── broadcast/                       ← (将来用 / 現在は使わない)
└── .last-worker-surface             ← spawn 時の内部状態 (非public)
```

## 識別子

| 概念 | 名前 | 例 |
|---|---|---|
| 通信単位 | session_id | `f695cacc-14c6-4983-94af-d3eeb1d6649a` (UUID 小文字) |
| 画面操作単位 | surface_ref | `surface:42` (cmux API 用) |
| ワークスペース | workspace_id | `8118E1E4-8C3A-453E-AFF3-29BA0F514DA2` (UUID 大文字) |

`cmux-msg peers` でこのワークスペース内の alive な session 一覧を確認できる。
