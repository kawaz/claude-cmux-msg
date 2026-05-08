# journal/

日々の作業の生記録。non-stop 作業や長時間セッションの後、膨大なチャットログを追うより journal を読み返す方が状況復元しやすい。

## 命名

`YYYY-MM-DD-<slug>.md`（発生日プレフィックス必須）。

`<slug>` は作業内容を表す短い名前（例: `docs-structure-finalization`、`broadcast-id-introduction`、`nitpick-strengthening`）。

**並列作業時は slug ごとに別ファイル**。複数の関心事が同じ日付に走っていても、ユーザが「あの作業の話」を slug で引ける。チャットログは並列作業が時系列で交錯するが、slug 別ファイルなら関心事ごとに整理されて読める。

## 中身の粒度

- **ハマり所 → 解決策のペア**: 「X で詰まった、Y で解決」を明示
- **設定値・コマンド・変更点**: 後でコピペで再現できる程度の具体性
- **議論の要点**: 結論だけでなく、なぜその結論になったかの経緯

`docs/findings/` は「確定事実」中心、こちらは「経緯と試行錯誤」中心。

## いつ書くか

- non-stop モードや並列タスク中、作業の節目で書く
- issue を解決した時、経緯を残したいなら journal に記録してから issue を delete
- DR を立てるほどではない議論や試行錯誤も journal に
- 「何回も同じ問題に当たる」ようなら runbook 化を検討

詳細は `~/.claude/rules/docs-knowledge-flow.md`。

## 関連

- `~/.claude/rules/docs-structure.md` の `journal/` 項
- `~/.claude/rules/docs-knowledge-flow.md` — いつ何を書くかのフロー
- 実例: kawaz/zunsystem の業務リポジトリでの運用 (`docs/journal/`, `docs/todo/`, `docs/references/`)
