# claude-cmux-msg

all: test build validate

test:
    bun test

build:
    bun run build

validate:
    claude plugin validate .

version:
    @jq -r '.version' .claude-plugin/plugin.json

# バージョン bump (major, minor, patch)
version-bump level="patch":
    bump {{level}} -w -f .claude-plugin/plugin.json      -p '"version":\s*"([^"]+)"'
    bump {{level}} -w -f .claude-plugin/marketplace.json -p '"version":\s*"([^"]+)"'
    bump {{level}} -w -f package.json                    -p '"version":\s*"([^"]+)"'
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

# working copy が clean (未確定変更がない) ことを確認
ensure-clean:
    @[ -z "$(jj diff --summary 2>/dev/null)" ] \
        || { echo "ERROR: working copy に未確定変更があります。describe してから push してください" >&2; exit 1; }

# 多言語ドキュメントの翻訳整合チェック
# - {BASE}-ja.md と {BASE}.md の両方が存在すること
# - 相互リンクが互いの末尾に張られていること
# - {BASE}-ja.md が {BASE}.md より新しい場合はエラー (翻訳更新が必要)
#   タイムスタンプは git log の commit timestamp を使う (stat mtime は jj 切替で揺れる)
check-translations:
    #!/bin/bash
    set -e
    for base in README DESIGN; do
      ja="$base-ja.md"; en="$base.md"
      [ -f "$ja" ] || continue
      [ -f "$en" ] || { echo "ERROR: $ja があるが $en がない" >&2; exit 1; }
      grep -q "$en" "$ja" || { echo "ERROR: $ja に $en へのリンクがない" >&2; exit 1; }
      grep -q "$ja" "$en" || { echo "ERROR: $en に $ja へのリンクがない" >&2; exit 1; }
      ja_t=$(git log -1 --format=%ct -- "$ja" 2>/dev/null)
      en_t=$(git log -1 --format=%ct -- "$en" 2>/dev/null)
      # まだ commit されていないファイルは比較スキップ (相互リンク check は別途効く)
      [ -n "$ja_t" ] && [ -n "$en_t" ] || continue
      if [ "$ja_t" -gt "$en_t" ]; then
        echo "ERROR: $ja ($ja_t) が $en ($en_t) より新しい。翻訳更新が必要" >&2
        exit 1
      fi
    done

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
