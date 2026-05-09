# Claude Code slash command 検知の可能性調査

`/rename` `/color` などの Claude Code ビルトイン slash command を cmux-msg 側から検知して `meta.json` に反映できるかを調査した結果。

依頼元: `docs/issue/2026-05-09-research-detect-claude-slash-commands.md`
実装側 issue: `docs/issue/2026-05-09-rename-color-not-reflected-in-peers.md`

## 判明した事実

| 候補 | 可能性 | 備考 |
|---|---|---|
| 1. Claude Code hook (SlashCommand 等) | **不可** | `UserPromptExpansion` は slash command 展開時に発火するが、`/rename` `/color` はビルトインで内部処理され、payload に command 名/引数は含まれない |
| 2. Claude Code 状態ファイル監視 | **不明** | `~/.claude/projects/{project-hash}/{session-id}.jsonl` 等に `/rename` `/color` の実行イベントが記録されるかは未検証。記録されるならば fswatch で監視可能 |
| 3. Claude Code Plugin API | **不可** | session metadata 変更を購読する API は無い。SessionStart hook は起動時メタデータのみ受け取る |
| 4. `claude` CLI 状態取得サブコマンド | **不可** | `claude project` は purge のみ。`session info` 等は存在しない |

## 結論

公式の API・hook 経路では検知できない。実用的に成立しうる経路は **(2) 状態ファイル監視のみ** だが、

- 監視対象ファイルのフォーマット (`*.jsonl`) は内部実装依存で Claude Code バージョン更新で破壊される可能性
- 「監視対象がそもそも書き換わるか」の検証が未了
- cmux-msg のスコープを超える (Claude Code 内部状態への侵入)

ため、cmux-msg では **対応しない方針** とする。

## 実用的な示唆

- `cmux-msg peers` の name 列は **spawn 時の name** をそのまま表示する設計に留める
- `/rename` 後に peers の表示が古くなることは「現状の制約」として `docs/DESIGN-ja.md` に明文化する
- もし監視 (2) を試したい人がいれば、まず `~/.claude/projects/<hash>/<session-id>.jsonl` を tail して `/rename foo` 実行前後の差分を取り、event 型を確認するところから (この findings に追記する形)

## 検証の詳細

claude-code-guide agent (Anthropic 公式 doc 参照) による調査:
- Hooks: https://code.claude.com/docs/en/hooks.md
- Plugin API: https://code.claude.com/docs/en/plugins.md

cmux-msg-impl ワーカーが 2026-05-09 に実施。
