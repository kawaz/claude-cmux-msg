# CLI を LLM-friendly に: `reply --body` / `send --to` flag 形式の許容

- Status: Open
- Date: 2026-05-27
- Priority: Middle
- 発見元: 2026-05-27 hyoui + cmux-msg 並列実験で child claude (LLM) の試行錯誤をcsa timeline で観測

## 観測された事実

`hyoui run --mode=headless -- claude --session-id <uuid> "..."` で headless 起動した child claude が cmux-msg を呼ぶときに、**positional argument で呼ぶべきところを `--body` / `--to` フラグ形式で呼ぼうとして失敗** していた。csa timeline (turn 3) で確認:

```
Bf0088e9b  …/cmux-msg send --to a822a3d2-... --body "kawazから…"   ← 失敗
B982a0981  …/cmux-msg send --help                                     ← help 読み直し
B89eb2054  …/cmux-msg --help                                          ← 全体 help 読み直し
B67ecf1c7  …/cmux-msg send a822a3d2-... "..."                         ← 成功: positional
```

エラーは:

```
エラー: session_id は UUID 形式が必要です: --to
```

また reply でも同様の癖が出ていて、turn 1 の reply 呼び出しでは:

```
Bf0e63c6b  …/cmux-msg reply <file> --body "「憑依」は…"
```

`reply` 側は `<file>` のあとは全て本文として受け取る挙動だったため、`--body` が**本文の先頭プレフィックスとして記録**されてしまった (相手側の受信メッセージ本文に `--body ` という文字列が残った)。

## 何が起きているか

LLM (特に claude) は `gh issue create --body "..."` `gh pr create --body-file ...` のような **フラグ形式の慣習**で各種 CLI を呼ぶ傾向が強い。これは事前学習のコーパス分布の偏り。positional 設計の CLI は、初手で誤用 → エラー → help 読み直し → リトライ、という 3〜4 ツール呼び出し分の試行錯誤コストを LLM に強いる。

cmux-msg のメッセージ送受信ツール (`send` / `reply` / `tell`) は cmux-msg の中で最も呼ばれる頻度が高く、LLM の試行錯誤コストが直接スループットに効く。

## 改善案 (どれか or 組み合わせ)

### 案 A: `--to` / `--body` を alias として正式サポート

```
cmux-msg send --to <sid> --body "本文"     # = cmux-msg send <sid> "本文"
cmux-msg reply --file <f> --body "本文"     # = cmux-msg reply <f> "本文"
cmux-msg tell --to <sid> --body "本文"      # = cmux-msg tell <sid> "本文"
```

- positional 設計はそのまま維持 (人間の手打ち / 既存スクリプトを壊さない)
- flag 形式も受け入れる (LLM の癖を吸収)
- ヘルプには「positional でも flag でも同じ」と明示

実装コスト軽め (引数パーサに alias 追加)。

### 案 B: エラー文言を LLM-friendly に

`--to` / `--body` を渡されたときのエラーを:

```
エラー: --to / --body は受け付けません。
        cmux-msg send <session_id> <本文>   の positional 形式で書いてください。
        例: cmux-msg send a822a3d2-... "メッセージ本文"
```

のように **直接書式を提示**する。LLM が次のリトライで help を読み直さずに済む。

### 案 C: reply の本文プレフィックス保護

`reply <file> --body "本文"` のように呼ばれた場合、**`--body ` が本文に紛れ込む現在の挙動**は LLM 起源の誤用が常態化することを考えると保護した方が良い。挙動候補:

- `--body` で始まる本文を検知したら警告 + ハイフン剥がし (危険: 意図的に `--body` で始まる本文を書きたい人を妨害する)
- そもそも `--body` を受け付けて positional に振り替える (= 案 A)

## 推奨

**案 A + 案 B の組み合わせ** が筋。

- 案 A で誤用そのものを成功させる (LLM のフリクション削減)
- 案 B は alias を入れない代替コマンド (例えば `screen` / `peers`) のエラー文言も併せて見直すきっかけに

## 関連

- 発見セッションのリポ: kawaz/claude-cmux-msg (本リポ)
- 観測手段: [[2026-05-27-observation-via-csa-timeline]] (csa timeline の cursor 読み で child の試行錯誤を増分観測する手順)
- 関連: hyoui/docs/issue/2026-05-27-feedback-from-cmux-msg-experiment.md (同セッションで見つけた hyoui 側のフィードバック)
