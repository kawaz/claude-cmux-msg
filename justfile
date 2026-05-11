# claude-cmux-msg
#
# kawaz/* リポの共通テンプレ (kawaz/bump-semver justfile が canonical) に揃えてある。
# 言語依存箇所 (lint/test/build) と claude-plugin 固有 (validate/check-bundle) のみカスタム。
# 構造変更は bump-semver 側を先に直してからこちらへ追従する。
# ---------- settings ----------

set unstable
set guards
set lazy
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set script-interpreter := ["bash", "-eu", "-o", "pipefail"]

# ---------- variables ----------
# jj/git 判定 (path_exists は "true"/"false" 文字列を返すので、bash の `if {{ is-jj }}; then` で
# bash builtin として評価できる)。jj/git 並存時は jj 優先 (kawaz の git bare + .jj 構成と整合)。

is-jj := path_exists('.jj')
is-git := if is-jj == "true" { "false" } else { path_exists('.git') }

# bump-version トリガとなる product code パス (テンプレ流用時に各リポで上書き)。
# docs/ や *.md / justfile / version ファイル自身などは除外。

bump-trigger-paths := "src/ skills/ hooks/ cmux-msg.plugin.zsh completions/ bin/cmux-msg bun.lock tsconfig.json"

# bump 対象の version ファイル群 (claude-plugin 固有: 3 ファイルの version 一致は bump-semver が保証)

version-files := ".claude-plugin/plugin.json .claude-plugin/marketplace.json package.json"

# ---------- default ----------

# レシピ一覧を表示
default:
    @just --list

# ---------- main entries (利用者が直接叩く) ----------

# push (main@origin に push 後、ローカルプラグインも自動更新)
push: ensure-clean test check-translations check-version-bumped
    jj bookmark set main -r @-
    jj git push --bookmark main
    claude plugin marketplace update cmux-msg
    claude plugin update cmux-msg@cmux-msg

# version を bump して Release commit を作成 (push は別途 `just push`)
bump-version bump="patch": ensure-clean
    new_version=$(bump-semver {{ bump }} {{ version-files }} --write --no-hint) && jj commit -m "Release v${new_version}"

# CI 単一エントリ (lint→test→build→validate→check-bundle を依存重複排除で1回ずつ保証)
ci: lint test build validate check-bundle

# ---------- dev recipes (push/ci の依存、利用者が直接叩くこともある) ----------

# lint (justfile フォーマット確認のみ。TS の型チェックは bun build/test 側で行う)
lint:
    just --fmt --check --unstable

# テスト
test: lint
    bun test

# ビルド (TypeScript → bin/cmux-msg-bin)
build: lint
    bun run build

# Claude Plugin の構造検証
validate: lint
    claude plugin validate .

# 現在の version を表示 (3 ファイルの一致確認も兼ねる)
version:
    @bump-semver get {{ version-files }} --no-hint

# ---------- check recipes (push の sanity 検証、基本は push 経由でしか叩かない) ----------

# bin/cmux-msg-bin が生成されること (build の事後検証)
check-bundle: build
    test -x bin/cmux-msg-bin || { echo "ERROR: bin/cmux-msg-bin が生成されませんでした。" >&2; exit 1; }

# ワーキングコピーがクリーン (jj は @ が empty、git は porcelain 空)
ensure-clean: lint
    if {{ is-jj }}; then [ "$(jj log -r @ --no-graph -T 'empty')" = "true" ]; fi
    if {{ is-git }}; then [ -z "$(git status --porcelain)" ]; fi

# 翻訳ペア (NAME-ja.md / NAME.md) の整合性チェック (対象は明示列挙、-ja.md 不在ならスキップ)
check-translations: ensure-clean (_check-translation "README") (_check-translation "docs/DESIGN") (_check-translation "docs/MANUAL")

# 翻訳ペア NAME-ja.md / NAME.md の存在 + 相互リンク + timestamp 順序確認

# `?` sigil (set guards := true) で -ja.md 不在時は recipe 全体を success として早期 return
_check-translation name:
    ?test -f {{ name }}-ja.md
    test -f {{ name }}.md
    head -5 {{ name }}-ja.md | grep -qF "> [English](./{{ file_name(name) }}.md) | 日本語"
    head -5 {{ name }}.md    | grep -qF "> English | [日本語](./{{ file_name(name) }}-ja.md)"
    test "$(just _file-ts {{ name }}-ja.md)" -le "$(just _file-ts {{ name }}.md)"

# file の最終 commit timestamp (jj/git 自動切替、stdout に epoch 秒)
[script]
_file-ts file:
    if {{ is-jj }}; then
        jj log --no-graph -T 'committer.timestamp().format("%s")' -r "latest(::@ & files('{{ file }}'))" 2>/dev/null || echo 0
    elif {{ is-git }}; then
        git log -1 --format=%ct -- {{ file }} 2>/dev/null || echo 0
    else
        echo 0
    fi

# product code に変更があれば version も main@origin より bump 済 (変更なしならスキップ)

# bump-semver compare gt FILE vcs:main@origin:FILE: ローカル > origin/main なら exit 0
[script]
check-version-bumped:
    # 変更なしなら早期 return (success)
    if {{ is-jj }}; then
        # jj diff の exit code は常に 0 だが、main@origin 未 track 等の失敗は伝播させる必要がある
        diff_out=$(jj diff -r 'main@origin..@' --summary -- {{ bump-trigger-paths }}) || { echo 'ERROR: jj diff failed (main@origin not tracked? run jj git fetch first)' >&2; exit 1; }
        [ -z "$diff_out" ] && exit 0
    elif {{ is-git }}; then
        git diff --quiet origin/main -- {{ bump-trigger-paths }} && exit 0
    fi
    # バージョン更新済みだったなら return (success)
    bump-semver compare gt .claude-plugin/plugin.json vcs:main@origin:.claude-plugin/plugin.json --no-hint && exit 0
    echo 'ERROR: code changed but version not bumped; run "just bump-version"' >&2; exit 1
