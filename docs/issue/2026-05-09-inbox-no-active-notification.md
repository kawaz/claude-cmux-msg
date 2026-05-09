# inbox 新着の能動通知がなく、相手の応答に気付けない

## 症状

子 CC が親 CC に `cmux-msg send` で返信を送っても、親 CC は **能動的に `cmux-msg list` を打たない限り気付けない**。

実例 (2026-05-09、報告者の親セッションでの体験):

1. 親が子セッションへ作業指示を送る (`cmux-msg send <child-id> "..."`)
2. 子が作業を完了し、親へ完了報告を送る (`cmux-msg send <parent-id> "v0.1.0 リリース完了 ..."`)
3. **親は何も通知を受け取らない**。親は別の作業をしながら、ふと「子は終わったかな?」と思って `cmux-msg list` を打つまで完了に気付かない
4. ユーザから「子が報告完了したと書いているが届いてない?」と指摘されて初めて `cmux-msg list` で発見

ユーザの想定 = 「届いた事は何かしらの形で能動通知される」と、cmux-msg の現実 = 「inbox に静かに置かれるだけ、見に行かないと気付けない」のギャップ。

## なぜ気付きづらいか

- `SessionStart` hook で `[cmux-msg] 初期化済み` が出るが、これは起動時のみ。session 中の新着には反応しない
- `cmux-msg subscribe` という JSONL stream は提供されているが、**親 CC が能動的に Monitor で起動しない限り発火しない**。つまり「subscribe を起動する」というアクションを別途取らないと通知ループが回らない
- AI エージェント側からは「inbox に何か届いたか」を知る手段が `list` を能動的に打つことだけ。AI は基本的に自分のターン以外で能動行動しないので、相手からの応答を待ってる間に inbox を見ない

結果として、cmux-msg を使った親子間のコラボレーションは:

- 親がポーリング ( `cmux-msg list` を頻繁に打つ ) で待つ
- ユーザが「届いてないか?」と促してくれて気付く

のいずれかになっており、本来の「非同期メッセージング」のメリットが活かせていない。

## 期待

新着 inbox メッセージを **親 CC のセッション内に push する** 仕組みが欲しい。具体案:

### 案 A: PostToolUse / Stop hook で inbox を自動チェック

CC のあらゆる tool 実行後 (もしくは Stop event = 「ターンを返す直前」) に `cmux-msg list --new-only` を呼んで、新着があれば stderr に出すフック。これだと AI は次のターンでメッセージに気付ける。

### 案 B: SystemReminder インジェクション

cmux-msg 自身が CC のメッセージストリームに `<system-reminder>` 風の通知を差し込めれば、AI は能動的に list を打たなくても気付ける。Claude Code の hooks API で実現可能か要調査。

### 案 C: `cmux-msg subscribe` を SessionStart hook で自動起動

SessionStart hook で `cmux-msg subscribe` を Monitor 経由でバックグラウンド起動する設定を、cmux-msg plugin の `hooks.json` で標準提供する。今は subscribe を「使ってよ」と書いてあるが、起動の手間が利用障壁になっている。

報告者の好みは **案 C (デフォルトで subscribe が走る) + 案 A (Stop event での補完チェック)** の組み合わせ。

## 影響

- 親子コラボ型ワークフロー (今回の bump-semver 実装委譲) が成立しづらい
- AI エージェント間の連携でレスポンス見逃しが頻発しそう
- ユーザが間に入って「届いてる?」と促す手間が増える

## 関連 issue

- (新規) `2026-05-09-spawn-output-missing-remote-url.md` (近接トピック: spawn 結果に必要情報が足りない)

報告者: 親 CC (session_id: `718c6cc3-b154-4de5-9cbe-cccd6dcfa407`) — 2026-05-09
