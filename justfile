# claude-cmux-msg

all: test build validate

test:
    @if ls src/**/*.test.ts >/dev/null 2>&1; then bun test; else echo "テストファイルなし (skip)"; fi

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
    jj split -m "chore: bump version" .claude-plugin/plugin.json .claude-plugin/marketplace.json

# バンドルをリビルドして差分があればエラー
check-bundle:
    @bun run build >/dev/null 2>&1
    @test -z "$(jj diff --summary bin/cmux-msg 2>/dev/null)" \
        || { echo "ERROR: バンドルが最新ではありません。ビルド結果をコミットしてください。" >&2; exit 1; }

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
