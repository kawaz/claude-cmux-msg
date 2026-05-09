# claude-cmux-msg

# CI とローカルの検査範囲を完全一致させる単一エントリ
# (旧 `just all` から改名、check-bundle / check-translations を追加)
ci: test build check-bundle check-translations validate

test:
    bun test

build:
    bun run build

validate:
    claude plugin validate .

version:
    @jq -r '.version' .claude-plugin/plugin.json

# バージョン bump (major, minor, patch)
# bump-semver v0.4.0 の multi-file + path-aware で 3 ファイル一括 bump。
# `.claude-plugin/marketplace.json` の `.metadata.version` も組み込みテーブルで
# 認識される。3 ファイルの version がずれていれば bump-semver がエラーで止める。
bump-semver level="patch": ensure-clean check-bundle test
    bump-semver "{{level}}" .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json --write
    @echo "Version: -> $(bump-semver get .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json)"
    jj split -m "chore: bump version" .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json

# コンパイル済みバンドルが生成されることを確認
# bin/cmux-msg はラッパースクリプト (git 管理対象)、bin/cmux-msg-bin は git 管理外
check-bundle:
    @bun run build >/dev/null 2>&1
    @test -x bin/cmux-msg-bin \
        || { echo "ERROR: bin/cmux-msg-bin が生成されませんでした。" >&2; exit 1; }

# plugin.json / marketplace.json / package.json のバージョン一致チェック
check-versions:
    #!/bin/bash
    set -e
    plugin_ver=$(jq -r '.version' .claude-plugin/plugin.json)
    market_ver=$(jq -r '.metadata.version' .claude-plugin/marketplace.json)
    pkg_ver=$(jq -r '.version' package.json)
    if [[ "$plugin_ver" != "$market_ver" ]]; then
        echo "ERROR: plugin.json ($plugin_ver) と marketplace.json ($market_ver) のバージョンが不一致" >&2
        exit 1
    fi
    if [[ "$plugin_ver" != "$pkg_ver" ]]; then
        echo "ERROR: plugin.json ($plugin_ver) と package.json ($pkg_ver) のバージョンが不一致" >&2
        exit 1
    fi

# main@origin から変更があればバージョン bump 必須
check-version-bump:
    #!/bin/bash
    remote_ver=$(jj file show .claude-plugin/plugin.json -r main@origin 2>/dev/null | jq -r '.version' 2>/dev/null)
    local_ver=$(jq -r '.version' .claude-plugin/plugin.json)
    if [[ "$local_ver" == "$remote_ver" ]]; then
        {
            echo "ERROR: 変更がありますがバージョンが未更新です。"
            echo "  bumpするなら: just version-bump [major|version|patch]"
            echo "  bump不要なら: just push-without-bump" >&2; exit 1; \
        } >&2
        exit 1
    fi

# ワーキングコピーがクリーン (empty) であることを確認
# `~/.claude/rules/docs-structure.md` の共通テンプレ
ensure-clean:
    test "$(jj log -r @ --no-graph -T 'empty')" = "true"

# 翻訳ペア (*-ja.md / *.md) の整合性チェック (`~/.claude/rules/docs-structure.md` 共通テンプレ)
# - リポジトリ内のすべての *-ja.md を find で発見
# - 対応する *.md の存在 + 相互リンク (タイトル直下) + commit timestamp 順序を検証
check-translations: ensure-clean
    #!/usr/bin/env bash
    set -euo pipefail
    die() { echo "$*" >&2; exit 1; }

    # commit timestamp 取得 (jj 管理リポジトリなら jj log、それ以外は git log)
    file_ts() {
        local f="$1"
        if [ -d .jj ]; then
            jj log --no-graph -T 'committer.timestamp().format("%s")' \
                -r "latest(::@ & files('$f'))" 2>/dev/null || echo 0
        else
            git log -1 --format=%ct -- "$f" 2>/dev/null || echo 0
        fi
    }

    while IFS= read -r ja; do
        en="${ja/-ja/}"
        [ -f "$en" ] || die "ERROR: $ja exists but $en is missing"
        # 相互リンク (先頭 5 行内、固定文字列で正確に検出)
        head -5 "$ja" | grep -qF "> [English](./${en##*/}) | 日本語" \
            || die "ERROR: $ja: missing '> [English](./${en##*/}) | 日本語' link near the top"
        head -5 "$en" | grep -qF "> English | [日本語](./${ja##*/})" \
            || die "ERROR: $en: missing '> English | [日本語](./${ja##*/})' link near the top"
        # ja のほうが新しい (= en の翻訳が遅れている) ことを検出
        ja_ts=$(file_ts "$ja")
        en_ts=$(file_ts "$en")
        [ "$ja_ts" -le "$en_ts" ] \
            || die "ERROR: $ja was updated after $en. Update the English translation before pushing."
    done < <(find . -name '*-ja.md' -not -path './.git/*' -not -path './.jj/*')

push: check-bundle check-versions check-version-bump check-translations ensure-clean validate
    jj bookmark set main -r @-
    jj git push
    claude plugin marketplace update cmux-msg
    claude plugin update cmux-msg@cmux-msg

push-without-bump: check-bundle check-translations ensure-clean
    jj bookmark set main -r @-
    jj git push
    claude plugin marketplace update cmux-msg
    claude plugin update cmux-msg@cmux-msg
