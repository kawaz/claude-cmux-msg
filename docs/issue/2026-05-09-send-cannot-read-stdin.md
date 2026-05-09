# `cmux-msg send` がメッセージを引数でしか受け取れず、長文 heredoc が組みづらい

## 症状

`cmux-msg send <session_id> <メッセージ>` の引数仕様で **メッセージは引数として渡す必要があり、stdin から読めない**。

長文 (改行 / quote 含む) を送りたいとき、bash heredoc を `$(cat)` 経由で渡すしか手がない:

```bash
cmux-msg send <id> "$(cat <<'EOF'
複数行の指示書...
これは行2
"これは引用付き"
EOF
)"
```

報告者は最初に「heredoc を直接 pipe で渡せば良い」と思って:

```bash
cat <<EOF | cmux-msg send <id> "$(cat)"
...
EOF
```

を試して混乱した (`$(cat)` は外側の `cat` ヒアドキュメントとは別の subshell でブロックする)。

## 期待

`cmux-msg send <session_id>` の単独形で **stdin からメッセージを読み込む** モードを提供。

```bash
cat <<'EOF' | cmux-msg send <id>
複数行の指示書...
EOF
```

もしくは:

```bash
cmux-msg send <id> --file - <<'EOF'
...
EOF

cmux-msg send <id> --file message.md
```

## なぜ重要か

AI エージェント間のメッセージは長文の指示書 (実装方針 / 仕様 / 制約) になりがち。引数だけだと:

- shell quote のエスケープが必要 (シングルクオート内のシングルクオートが書けない)
- 改行を `\n` で渡そうとしても引数長制限 (`getconf ARG_MAX` で 256KB-1MB 程度) に近づくと壊れる
- AI が動的に組み立てる長文では特に書きづらい

`mail`, `git commit -F -`, `gh pr edit --body-file -` 等、Unix 系 CLI の慣習として stdin or `--file` 経由でテキストを受け取る選択肢を用意するのが自然。

## 実装案

- `--file <path>` (`-` は stdin) を追加
- 引数 `<メッセージ>` が省略されたら自動で stdin から読む (ただし対話的入力との誤動作回避のため `isatty(0)` チェック必須)

## 関連

- 引数解析全般の問題は `2026-05-09-spawn-args-consume-cli-flags.md` でも触れている

報告者: 親 CC (session_id: `718c6cc3-b154-4de5-9cbe-cccd6dcfa407`) — 2026-05-09
