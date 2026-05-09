# 2026-05-09 bump-semver migrate (justfile + CI 統一)

claude-cmux-msg の `version-bump` レシピを `bump-semver` に移行 + `just ci` 1 行化を実施。

## 経緯

1. cmux-msg-impl ワーカーが migrate に着手 → bump-semver v0.3.0 では `.claude-plugin/marketplace.json` (`metadata.version` ネスト構造) が扱えないと判明
2. kawaz 指摘: 「`*.json` を `.version` 決め打ちは初期実装の安易な判断。**パス構造も含めた confidence ランキング**で候補を絞る設計にすべき」
3. 上流に設計改善 issue 起票 (`kawaz/bump-semver/main/docs/issue/2026-05-09-path-aware-confidence-ranked-candidates.md`)
4. bump-semver v0.4.0 で path-aware 対応がリリース → migrate 解禁
5. 本セッションで migrate 実施

## 変更内容

### `justfile`

- 旧: `version-bump` レシピで `kawaz/go/bin/bump` を 3 ファイル分繰り返し呼ぶ。各行で `-p '"version":\s*"([^"]+)"'` の regex を指定
- 新: `bump-semver` レシピで `bump-semver patch <3 files> --write` 1 行。regex 指定なし、外部 `bump` ツール依存も削除
- レシピ名は呼び出すツール名と揃えて `bump-semver` に統一 (kawaz/* 横断ルール `~/.claude/rules/docs-structure.md`「バージョン bump レシピ」節)
- 引数名 `level` は他リポと整合 (`patch` / `minor` / `major`)

```just
bump-semver level="patch": ensure-clean check-bundle test
    bump-semver "{{level}}" .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json --write
    @echo "Version: -> $(bump-semver get .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json)"
    jj split -m "chore: bump version" .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json
```

### `ci` レシピ + `.github/workflows/ci.yml`

- 旧: `all: test build validate` (CI workflow なし、CI とローカルで検査範囲がそろっていない)
- 新: `ci: test build check-bundle check-translations validate` を単一エントリ化
- CI workflow を新設 (`.github/workflows/ci.yml`): setup-bun + setup-just で `just ci` 1 行
- `all` レシピは削除 (やり方を 1 つに統一、kawaz の「やり方が複数あることは迷いとコンテキストの無駄を生む」ポリシー)

### 文書反映

- `CLAUDE.md` の「全チェック: `just all`」を「全チェック: `just ci` (CI とローカルで同じ範囲を検査)」に更新
- `docs/issue/2026-05-09-migrate-to-bump-semver-and-just-ci.md` は削除 (本 journal に経緯集約)

## 実弾運用 (v0.25.2)

migrate 自体は機能変更なしなので push-without-bump で先に送る。続けて新 `just bump-semver patch` で v0.25.2 にリリースし、ドッグフーディングで実弾動作確認。

## 学び

- shebang なしの just レシピは各行が独立した sh プロセス。bash 変数 (`new_version=$(...)` → `echo $new_version`) は次の行に引き継がれない。jj-worktree スタイル「bump で書いて、表示は `bump-semver get` で再取得」が正解
- bump-semver の multi-file は cross-file 整合性チェックが効く (3 ファイルの version がずれていればエラー)。これにより後追いで marketplace.json だけ jq で書き換える案が事故を起こすケースを未然に防げる
- `claude plugin validate .` は marketplace.json の `metadata.version` をそのまま読むため、bump-semver で正しく書き換えできていれば validate も通る
