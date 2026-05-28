# `cmux-msg read` で自動 accept (= 既読化) する案

- Status: Open
- Date: 2026-05-28

## 現状

- `cmux-msg read <filename>` は標準出力に md 全文を流すだけで、inbox/ にファイルが残る (= 未読扱い継続)
- `accept` で初めて inbox/ → accepted/ に移動 (= 既読化、未読カウントから外れる)
- 結果として「read だけして accept 忘れる」ケースで未読 N が溜まり、UX 上の小さい摩擦が出る (実例: 検証セッション中に 3 件残り、後で UserPromptSubmit hook で「未読 1 件」通知され続けた)

## 案

`cmux-msg read <filename>` を default で auto-accept (= 標準出力に流すと同時に accepted/ へ移動) する。read したくない / 後で再度参照したい場合は `--keep-unread` flag で escape 可能。

意味付け:
- read = 既読化 (= 「内容は確認した、未読カウントから外す」)
- accept = 「accept した」というラベルとしては読み = 同義に重ねる (= 別意味は持たせない)
- dismiss / archive はそのまま

## 副次: `read --help` / `accept --help` の bug

ついでに見つけた:

```
$ cmux-msg read --help
エラー: --help が inbox に見つかりません

$ cmux-msg accept --help
エラー: --help が inbox/ に見つかりません
```

`--help` を inbox key として解釈してしまう。他サブコマンドが `--help` を正しく扱う中で、`read` / `accept` の `--help` だけ落ちてる感じ。同じ修正タイミングで一緒に直せると綺麗。
