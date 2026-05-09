# `justfile::version-bump` を `bump-semver` に移行 + `ci` レシピ + `just ci` 1 行 CI

## 背景

2026-05-09 に `kawaz/bump-semver` v0.2.0 がリリース済。`brew install kawaz/tap/bump-semver` で導入可能。`Cargo.toml` / `*.json` / `VERSION` を basename で自動判定する flat 4-action CLI (`bump-semver <major|minor|patch|get> <FILE | --value VER> [--write]`)。

claude-cmux-msg は **bump-semver の主要消費者** に位置づけられている (3 ファイル同時 bump のユースケースが動機)。現在の `version-bump` レシピは外部の汎用 `bump` ツール (`kawaz/go/bin/bump`) を使い、3 ファイル分の `-p '"version":\s*"([^"]+)"'` を毎回書いている状態。これを `bump-semver` に移行する。

## やること (優先度順)

### 1. ローカル PATH に `bump-semver` を入れる前提条件

`kawaz/dotfiles/darwin/default.nix` の `homebrew.brews` に `"kawaz/tap/bump-semver"` を追加 (別 issue: `kawaz/dotfiles/docs/issue/2026-05-09-add-bump-semver-to-homebrew-brews.md`)。`just darwin-rebuild` で反映。

### 2. `version-bump` レシピを `bump-semver` に置換 + 改名

現状 (claude-cmux-msg/main/justfile):

```just
version-bump level="patch":
    bump {{level}} -w -f .claude-plugin/plugin.json      -p '"version":\s*"([^"]+)"'
    bump {{level}} -w -f .claude-plugin/marketplace.json -p '"version":\s*"([^"]+)"'
    bump {{level}} -w -f package.json                    -p '"version":\s*"([^"]+)"'
    jj split -m "chore: bump version" .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json
```

移行後 (推奨形):

```just
# レシピ名は呼び出すツール名と揃えて bump-semver に統一 (kawaz リポ全体で同じパターン)
# 引数名は level (semver bump level の慣用)
bump-semver level="patch": ensure-clean check-bundle test
    #!/usr/bin/env bash
    set -euo pipefail
    bump-semver "{{level}}" .claude-plugin/plugin.json      --write
    bump-semver "{{level}}" .claude-plugin/marketplace.json --write
    new_version=$(bump-semver "{{level}}" package.json      --write)
    echo "Version: -> ${new_version}"
    jj split -m "chore: bump version" .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json
```

ポイント:
- `-p` の regex 指定が **3 行とも消える** (basename 自動判定)
- 外部 `bump` ツール (`kawaz/go/bin/bump`) への依存がなくなる
- 3 ファイルとも `*.json` パターンで自動判定 (handler 1 つでカバー)
- レシピ名 `version-bump` → `bump-semver` に統一 (kawaz リポ全体で揃える)
- ツールの stdout (新バージョン) を最後の呼び出しで取得して echo 表示 (人間向け確認)

### 3. `ci` レシピ + `.github/workflows/ci.yml` の `just ci` 1 行化

現状の CI workflow が `cargo`/`bun` 等を直書きしているなら、claude-statusline 流の B 系統 (CI 一発型) に揃える:

```just
# 既存 lint / test / build / check-bundle 等を依存に取る単一エントリ
ci: lint test build check-bundle
```

```yaml
# .github/workflows/ci.yml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: oven-sh/setup-bun@v1
      - uses: extractions/setup-just@v3
      - run: just ci
```

これにより CI とローカルの検査範囲が `just ci` で完全一致 (差分が出ない構造)。

### 4. ドキュメント整備

`~/.claude/rules/docs-structure.md` の「バージョン bump レシピ」節を新ルールとして反映済 (2026-05-09)。これに沿って claude-cmux-msg の justfile / workflow を移行する。

## 想定される作業順序

1. `kawaz/dotfiles` の brew install 追加が完了していることを確認 (前提)
2. `which bump-semver` で `/opt/homebrew/bin/bump-semver` を確認
3. justfile の `version-bump` を `bump-semver` レシピに置換 + リネーム
4. CI workflow を `just ci` 1 行に集約
5. テスト実行: `just bump-semver patch` でローカル動作確認 (ただし version は実際に上がるので注意、`--value` で動作だけ試す手もあり)
6. push → CI 緑確認

## 関連

- bump-semver: https://github.com/kawaz/bump-semver (v0.2.0)
- 設計判断: `kawaz/bump-semver/main/docs/decisions/DR-0001-flat-actions-and-format-detection.md`
- 横断調査: `kawaz/jj-worktree/main/docs/findings/2026-05-09-justfile-template-research.md`
- 先行適用例: `kawaz/jj-worktree/main/justfile` (commit `ba9add89` 以降)
- ルール: `~/.claude/rules/docs-structure.md` の「バージョン bump レシピ」節

報告者: kawaz/jj-worktree main の親 CC (session_id: `718c6cc3-b154-4de5-9cbe-cccd6dcfa407`) — 2026-05-09
