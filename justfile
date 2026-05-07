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

# plugin.json と marketplace.json のバージョン一致チェック
check-versions:
    @test "$(jq -r '.version' .claude-plugin/plugin.json)" = "$(jq -r '.metadata.version' .claude-plugin/marketplace.json)" \
        || { echo "ERROR: plugin.json と marketplace.json のバージョンが不一致です。" >&2; exit 1; }

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

push: check-bundle check-versions check-version-bump validate
    jj bookmark set main -r @-
    jj git push
    claude plugin marketplace update cmux-msg
    claude plugin update cmux-msg@cmux-msg

push-without-bump: check-bundle
    jj bookmark set main -r @-
    jj git push
    claude plugin marketplace update cmux-msg
    claude plugin update cmux-msg@cmux-msg
