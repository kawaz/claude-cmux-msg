# issue/

このプロジェクト内の TODO + 他プロジェクトへの要望・改善提案を置く。

## 命名

`YYYY-MM-DD-<slug>.md`（発生日プレフィックス必須）。日付があると issue の追加に気付きやすく、時系列も自明。

## 用途

- (a) 自プロジェクト内 TODO（`docs/ROADMAP.md` よりも具体・短期）
- (b) 上流ライブラリ・依存プロジェクトへの要望／改善提案。後で issue として上流に投げる材料

## 解決時のフロー

**delete する**。ただしその前に、解決の性格に応じて以下に記録を残してから消す:

| 解決の性格 | 記録先 |
|---|---|
| 単純なコード修正のみ | 記録不要（CHANGELOG / コミットで十分） |
| 設計判断を伴う | `docs/decisions/DR-NNNN-...md` |
| 運用上の再発可能性 | `docs/runbooks/<topic>.md` |
| 経緯・試行錯誤を残したい | `docs/journal/YYYY-MM-DD-<slug>.md` |

詳細は `~/.claude/rules/docs-knowledge-flow.md` 参照。

delete することで一覧 (`ls docs/issue/`) は常に「現在オープンな課題」と直結する。jj/git 履歴で「いつ気付いて、いつ解決したか」は追える。
