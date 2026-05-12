# cmux-msg メッセージ保管庫

このディレクトリは **cmux-msg プラグイン** が cmux 上の Claude Code セッション間
メッセージをファイルとして保管する場所。

## 階層構造

```
~/.local/share/cmux-messages/        ← ここ (root)
├── README.md                        ← この文書を指す symlink
├── .docs/                           ← README.md の参照先 (cmux-msg プラグイン管理、触らない)
├── by-surface/                      ← cmux surface_id → session_id の lookup index
├── .workspace-state/                ← workspace ごとの内部状態 (spawn の last-worker 等)
├── <session_id>/                    ← 1 claude セッション分の受信箱 (UUID v4 小文字)
│   └── README.md                    ← `<session_id>` 階層の説明
└── ...
```

`<session_id>` は `claude --session-id <uuid>` で採番される UUID v4（小文字）で、
1 つの claude セッションに対応する。workspace は session に紐付くメタ情報として
`<session_id>/meta.json` に記録され、ディレクトリ階層には反映されない。

直下に入って `README.md` を読むと次の階層の意味が分かる。

## 関連

- プラグイン本体: <https://github.com/kawaz/claude-cmux-msg>
- CLI ヘルプ: `cmux-msg help`
- ピア一覧: `cmux-msg peers --by <axis>` / `cmux-msg peers --all`
