# 2026-05-08 docs 構造ルールと設計優先度ルールの確立

## 経緯

5/7 〜 5/8 にかけて kawaz/claude-cmux-msg `9c082e35` セッションで non-stop モードの大規模リファクタを実施。0.7.0 → 0.22.0 まで 16 リリース。

リファクタの中で「設計の歪みを後方互換のため温存していないか」「対応コストを判断軸にしていないか」を繰り返し問い直し、結果として 2 つのルールが結晶化した。

1. `~/.claude/rules/design-priority.md` — 設計判断は「正しさ」「ベストプラクティス」「より良いか」を最優先、対応コストは判断軸にしない
2. `~/.claude/rules/docs-structure.md` — kawaz/* 横断の docs/ 構成方針

## docs 構造の議論経緯

### きっかけ

ユーザ発言（要約）: 「ドキュメントのまとめ方が他プロジェクトとルールが異なるようなので整理したい。最近半年以内のプロジェクトの docs を見て共通パターンと変遷を見て」

最近 6 ヶ月の kawaz/* リポジトリ約 35 件を調査。docs/ 構成のバラつきが顕著:

- DR の置き場が **5 種類**（`decisions/`、`decision-records/`、直下 `dr-...`、`archive/dr-...`、`archives/NNN-...`）
- DESIGN ファイル名が大文字・小文字混在
- research / findings / knowledge / archive / drafts / plans が混在
- CHANGELOG を `docs/` 配下に置く異例ケース

### 確定事項（議論順）

| 論点 | 確定 |
|---|---|
| research / findings | 別維持（中期テーマの深掘り vs 短期・単発の検証） |
| DR ナンバリング | 4 桁（`DR-NNNN-title.md`、大文字 `DR`） |
| 既存リポマイグレーション | 触ったついで、一気にやらない |
| cmux-msg 固有 layout | `docs/design/data-layout-*.md`（design 付随、ハイフン付き複合名） |
| docs 直下の命名 | 1 単語ビシッと、ハイフン付きはサブディレクトリ用 |
| 配布物 vs ドキュメント | `share/` 同梱は古い、URL 誘導がモダン。ただしデータディレクトリ自身の自己言及は別 |
| 言語ポリシー | DR/research/findings は ja のみ、README/DESIGN は ja 原本 + 英訳 |
| 翻訳鮮度チェック | `just push` 依存、git log timestamp 比較（stat mtime は jj で揺れる） |
| `docs/repo-structure.md` 案 | 1 単語ルールに反するため不採用、`docs/STRUCTURE.md` に |
| 横展開ルール文書化 | 当初保留 → idea-storage 側の混乱を受けて本セッションで作成 |

### idea-storage `4c276112` からの引き継ぎ

5/8 終盤、idea-storage 側のセッションから「`docs/issue/` のルール化を起点に docs 構造議論を派生させたが、本拠は 9c082e35 で実施されていた」と引き継ぎを受領。idea-storage は私（cmux-msg 側）の確定事項を知らずに 3 桁・小文字 `dr-NNN-...md` で push してしまっていた。

これを契機に追加論点を整理:

| 追加論点 | 確定 |
|---|---|
| `docs/issue/` vs `docs/todo/` | `docs/issue/` |
| 解決時の扱い | **削除**（jj/git 履歴で追える、`done/` 移動なし） |
| journal 採用 | **採用**。non-stop 後の確認に膨大なログより journal が向く |
| AI 自己報告ルール | 別問題（ライブラリ実装ルール）として分離、本議論からは無視 |
| 横展開ルール文書化 | 本セッションで作成（劣化版になるリスクを避ける） |
| `guide` 命名 | 「開発者向け or ユーザ向け」が読み取れず曖昧。`docs/manual.md` のように audience が分かる名前を使う。`docs/guides/` は不採用 |

### audience-prefix のメタ法則は不採用

zunsystem の業務リポジトリで「対象 audience 名を含むガイド」のような命名が見られたが、固有のパートナー名を含むケースもあり、kawaz 流のルールとして一般化できる事項ではないとの判断。

→ `${audience}-guide.md` のような汎化は不要。エンドユーザ向けは `manual.md` の単独命名で扱う。`docs/guides/` のような汎用ディレクトリも採用しない（「開発者向け」か「ユーザ向け」かが読み取れず曖昧）。

## 設計優先度ルールの確立

ユーザ発言: 「後方互換ガーとか修正が大変とかよりも、設計が正しいかベストプラクティスに則っているかなどより良いのはどちらか、という観点を最重要視して作業するように」

→ `~/.claude/rules/design-priority.md` を新設。本セッションでも複数の設計判断（MSG_BASE 二重提供廃止、message.ts 責務分離、shellSingleQuote、PID 衝突対策など）にこのルールが効いた。

## nitpick-reviewer の強化

セッション中盤、nitpick-reviewer agent (`~/.claude/agents/kawaz-nitpick-reviewer.md`) を強化:

- 罵倒・皮肉・人格言及を **禁止**（萎縮させるのが目的ではない）
- 執念・網羅性を **強化**（必要な指摘を絶対見逃さない）
- 「対応コストは判断軸にしない」を絶対ルールに
- ペルソナを 10 → 14 種に拡張（**悪用シナリオ追跡者**を独立、**技術的負債の管理人**、**テストカバレッジ監査人**、**将来の保守担当代弁** を追加）
- 自己点検チェックリストを出力前に通す

実際このセッションで一度走らせて 40 件の指摘を得た。ほぼ全て対応または保留判断で消化。

## 命名ルールの最終調整 (5/8 後半)

横展開ルール (0.23.0) 作成後、ユーザから追加判断を受けて命名ルールを詰めた。確定仕様は `~/.claude/rules/docs-structure.md` 参照、0.24.0 でリリース。

経緯のみ記録:

- メタ原則セクションは不要 → 削除
- docs 直下を大文字化、サブディレクトリ全カテゴリで日付プレフィックス必須
- OSS 必須対象 (README/DESIGN/MANUAL) と英語版遅延 OK フロー
- 相互リンクをタイトル直下に
- `check-translations` を先頭 5 行限定でタイトル直下を強制

日付プレフィックスを全カテゴリで必須にした理由:

- 数が増えた時に気付きやすい (タイムスタンプ表示と違って ls で常に見える)
- jj/git の commit timestamp は rebase で揺れるため、ファイル名側に作成日を持つほうが信頼できる
- slug に内容情報があるので日付追加で情報量は減らない

## 業務関連固有名詞の history 書き換え

業務関連の固有名詞 (組織内リポジトリ名、関係者名等) は public リポジトリで避けるルール。push 済みコミットも `--ignore-immutable` で書き換え。具体的な単語自体は本 journal でも記載しない (記載すること自体が同じ問題を起こすため)。

jj 操作のハマり所:

- `jj edit -r <commit> --ignore-immutable` で immutable boundary を越えて書き換え可能
- 下流 commit は自動 rebase されるが、同じ箇所を編集していると conflict
- conflict 時は当該 commit に切り替えて working copy で手動解消
- `just push-without-bump` で sideways move push (history 書き換え、bump なし)
- commit message にも固有名詞が残ることがあるので `jj describe` も忘れずに

## 残作業

- idea-storage の docs 再整理（`dr-NNN-...md` → `DR-NNNN-...md`、`guides/recipe-authoring.md` の置き場再決定、issue ファイルの命名を `YYYY-MM-DD-<slug>.md` に）→ idea-storage 側で実施
- 他既存リポの「触ったついで」マイグレーション（急がない）

## 参考

- 議論本拠: 本セッション（kawaz/claude-cmux-msg `9c082e35`）
- 引き継ぎ元: kawaz/idea-storage `4c276112`、`docs/journal/2026-05-08-docs-structure-investigation.md`
- DR 統一作業（3 桁時代）: kawaz/port-peeker `64bac255`
- journal 運用の実例: kawaz/zunsystem の業務リポジトリ `a780f941`、`docs/journal/`
- このセッションの成果: 0.7.0 〜 0.24.0 の 18 リリース、`~/.claude/rules/design-priority.md`、`~/.claude/rules/docs-structure.md`、`~/.claude/rules/docs-knowledge-flow.md`
