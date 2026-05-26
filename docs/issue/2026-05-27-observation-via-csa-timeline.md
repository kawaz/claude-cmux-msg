# child の内部観測には csa timeline cursor を併用する (skills/ ドキュメント補強)

- Status: Open
- Date: 2026-05-27
- Priority: Low (ドキュメント追記)
- 発見元: 2026-05-27 hyoui + cmux-msg 並列実験

## 背景

cmux-msg は「親⇔child の明示的メッセージング」のレイヤを担うが、child の **内部活動 (think / tool call / 試行錯誤)** は cmux-msg からは見えない。

例えば child が `cmux-msg send` を投げてきた時、その投稿に至るまでに child がどんな試行錯誤をしたか (今回の例: `send --to ... --body ...` で 3 回失敗 → help 読み直し → positional で成功) を親が知る手段は cmux-msg だけだと無い。

これを補う手段として `hyoui tail <child-sid> --strip-ansi` で TUI scrollback を覗く方法もあるが:

- 装飾文字・ステータスバー・Tip 表示が混ざって読みにくい
- 「前回見たところから差分だけ読む」が grep でしか実現できず手間
- 入力源 (cmux-msg send / Remote Control / 元 PTY) を画面表現から区別する必要があり脆い

## 提案: skills/cmux-msg/ に「csa timeline cursor 読みの併用」を追記

[claude-session-analysis](https://github.com/kawaz/claude-session-analysis) (csa) の `timeline` サブコマンドは **marker (event id) ベースの range 指定**ができる:

```
Range:
  N..M       Turns N to M
  marker..   From marker to end (e.g. Uabc1234..)
  from..to   Between markers
```

これを使うと「前回読んだところから先だけ」を **cursor 的に増分取得**できる。

具体的な使い方 (skills/cmux-msg/SKILL.md に追記したい内容案):

```bash
# 親が child_sid を spawn したら、以後は subscribe event を契機に
# child の内部活動を csa timeline で増分取得 (cursor 方式)

last_marker=""
on_subscribe_event() {
  # 増分取得 (初回は全件、2 回目以降は last_marker から)
  out=$(csa timeline "$child_sid" --jsonl ${last_marker:+${last_marker}..})
  # 解析…
  # 最後の event id を次の cursor に
  last_marker=$(echo "$out" | tail -1 | jq -r .id)
}
```

これで child が `cmux-msg send` を投げてきた時、その内部で何を考えてどんな試行錯誤をしたか (例: `--body` / `--to` 誤用と help 読み直し) を親が低コストで観測できる。

### ツール組み合わせの責務分離 (skills/cmux-msg/SKILL.md にも記載候補)

| ツール | 担当レイヤ | 観測 / 制御の粒度 |
|---|---|---|
| cmux-msg | 親⇔child の明示的メッセージング | message 単位 (永続) |
| hyoui | child プロセスの起動・PTY proxy・状態待ち | process / TUI 画面単位 |
| csa timeline | child の内部活動 (user 発言・think・tool call) | event 単位 (cursor 付き、増分取得可) |

`hyoui tail` は「TUI そのものを見たい時のラストリゾート」、csa が日常的な観測手段、cmux-msg が明示通信、というレイヤ分けで運用すると整理しやすい。

## 関連

- [[2026-05-27-llm-friendly-cli-flag-alias]] — 同セッションで csa timeline で観測した child の試行錯誤を題材にした CLI 改善 issue
- 発見元のセッション ID: a99ec62d-9bbe-485e-941d-96010ee0439e (child #2)、a822a3d2-3b54-4ea4-8f18-30fcc124a3f8 (parent)
- 関連: csa README / skills/claude-session-analysis/SKILL.md (csa の使い方)
- 関連: skills/cmux-msg/SKILL.md (本 issue で追記提案する先)
