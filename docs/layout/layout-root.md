# cmux-msg メッセージ保管庫

このディレクトリは **cmux-msg プラグイン** が cmux 上の Claude Code セッション間
メッセージをファイルとして保管する場所。

## 階層構造

```
~/.local/share/cmux-messages/        ← ここ (root)
├── README.md                        ← この文書 (.docs/latest/layout-root.md への symlink)
├── .docs/                           ← 本文書群の実体
│   ├── v<version>/                  ← cmux-msg 各バージョンの layout-*.md コピー
│   └── latest → v<version>          ← 現バージョンを指す symlink
├── <workspace_id>/                  ← cmux ワークスペース単位 (UUID 大文字)
│   └── README.md                    ← `<workspace_id>` 階層の説明
└── ...
```

`<workspace_id>` は cmux 側が採番する UUID で、cmux インスタンス（≒ ターミナル
ウィンドウ）に対応する。直下に入って `README.md` を読むと次の階層の意味が分かる。

## 関連

- プラグイン本体: <https://github.com/kawaz/claude-cmux-msg>
- CLI ヘルプ: `cmux-msg help`
- ピア一覧: `cmux-msg peers`
