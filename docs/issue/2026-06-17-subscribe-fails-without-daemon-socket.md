# `cmux-msg subscribe` が cmux daemon socket 不在で起動失敗する

- Status: Will be sublimated after DR-0012 land (subscribe を cmux wait-for から
  Bun fs.watch + SQLite lock + watermark に置換、cmux daemon 不要に)
- 補完: DR-0010 完全 land (cmux 関連コード削除) でも同じ症状が消える

報告者: kawaz (2026-06-17、claude-rules-personal リポ作業中の Claude bg job セッションから)。

## 現象

cmux daemon が起動していない環境で `cmux-msg subscribe` を起動すると、
inbox を待つ前に即 exit 1 する:

```
[stderr] エラー: cmux wait-for がエラー終了しました (exit=1, 0.39s): Error: Socket not found at /Users/kawaz/.local/state/cmux/cmux.sock
```

`~/.local/state/cmux/` には `cmux.sock.lock` と `last-socket-path` だけが残っていて
`cmux.sock` は存在しない (= daemon 未起動)。

## 再現

```bash
# cmux daemon が動いていない状態 (= cmux ペイン内ではない、bg job 等)
$ ls ~/.local/state/cmux/
cmux.sock.lock
last-socket-path
$ cmux-msg subscribe
エラー: cmux wait-for がエラー終了しました (exit=1, ...): Error: Socket not found at /Users/kawaz/.local/state/cmux/cmux.sock
```

環境:
- Claude Code 2.x の background job として起動された session (`CLAUDE_JOB_DIR` あり、cmux ペイン外)
- `cmux-msg whoami` / `init` / `read` / `list` 等の inbox 操作系は問題なく動作
- 失敗するのは subscribe (= `cmux wait-for` 経由) のみ

## 観察

- subscribe の内部実装が `cmux wait-for` 経由で daemon socket に依存している
- 同じ inbox を `fswatch -0 --event Created --event MovedTo $inbox` で直接 watch すると正常に新着検出できた (= inbox file 自体は健在、daemon が無いだけ)
- bg job 経路 (= cmux ペインなしの Claude セッション) でも cmux-msg を使う場面はある (= 他の cmux 内 Claude からの message を受け取りたい)

## 仕様判断ポイント (= 当事者に委ねる)

私 (報告者側 Claude) からはどう直すべきか断定しない。以下は参考の選択肢:

1. **daemon なしでも subscribe を動かす** (= fs.watch 直接経路を fallback として持つ)
   - daemon 経路の利点 (= watermark / lock 等、DR-0012 関連) を捨てない形で fallback できるか
2. **daemon を autospawn**
   - subscribe 起動時に daemon が無ければ起動する
   - cmux ペイン外でも daemon を立てる意味があるかは別判断
3. **error message に起動手順を含める**
   - 「daemon が必要、`<起動コマンド>` で起動してから再実行」と明示
   - 現状の `Error: Socket not found at <path>` だけだと「何を打てば直るか」が分からない

実機での確認: `~/.local/share/repos/github.com/kawaz/claude-cmux-msg/` の subscribe 実装と
`cmux wait-for` 周辺、および DR-0012 (subscribe を SQLite lock + Bun fs.watch で解決) の
方針との整合は当事者側で見てください。

## ワークアラウンド (= 報告者が取った経路)

`fswatch` で inbox ディレクトリを直接 watch し、新着 file 名を `cmux-msg read <name>` に渡す:

```bash
INBOX=/Users/kawaz/.local/share/cmux-messages/<session_id>/inbox
fswatch -0 --event Created --event MovedTo "$INBOX" | while IFS= read -r -d '' f; do
  name=$(basename "$f")
  case "$name" in .*) continue ;; esac
  echo "新着: $name"
  cmux-msg read "$name"
done
```

- `cmux-msg read` 等の inbox 操作は daemon なしで動くので組み合わせれば運用は回る
- ただし subscribe が一級の API なら、daemon なし環境でも素直に動くのが期待値

## 関連

- [[2026-06-02-subscribe-double-launch-prevention]] — subscribe の lock / watermark まわりの設計 (DR-0012)。fallback 経路を入れる場合に整合確認が必要
