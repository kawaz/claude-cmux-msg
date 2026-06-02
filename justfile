# claude-cmux-msg
#
# kawaz/* リポの共通テンプレ (kawaz/bump-semver justfile が canonical) に揃えてある。
# 言語依存箇所 (lint/typecheck/test) と claude-plugin 固有 (validate) のみカスタム。
# VCS 操作 (clean 判定 / diff / push / commit) と翻訳鮮度チェックは bump-semver vcs
# サブコマンド (DR-0020 / DR-0027) に委譲し、jj/git 分岐の手書きを撲滅する。
# 構造変更は bump-semver 側を先に直してからこちらへ追従する。
# ---------- settings ----------

set unstable
set guards
set lazy
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set script-interpreter := ["bash", "-eu", "-o", "pipefail"]

# ---------- variables ----------
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

# push (バージョン bump 済みを前提、全 gate 通過後に push してローカルも更新)
push: ensure-clean ci check-translations check-versions check-version-bumped
    bump-semver vcs push --branch main --jj-bookmark-auto-advance
    @just _local-plugin-reload

# push (ドキュメント更新等のみで bump 不要な場合)
push-without-bump: ensure-clean ci check-translations check-versions
    bump-semver vcs push --branch main --jj-bookmark-auto-advance
    @just _local-plugin-reload

# version を bump して Release commit を作成 (push は別途 `just push`)
[script]
bump-version bump="patch": ensure-clean
    new_version=$(bump-semver {{ bump }} {{ version-files }} --write --no-hint)
    bump-semver vcs commit -m "Release v${new_version}" {{ version-files }}

# CI 単一エントリ (lint→typecheck→test→validate を依存重複排除で1回ずつ保証)
ci: lint typecheck test validate

# ---------- dev recipes (push/ci の依存、利用者が直接叩くこともある) ----------

# lint (justfile フォーマット確認のみ。TS の型チェックは typecheck recipe で行う)
lint:
    just --fmt --check --unstable

# 依存パッケージを install
# CI は node_modules 未 populate の状態から始まる。bun の auto-install は CLI (tsc) を
# 取得するだけで devDependencies (@types/bun 等) は入れないため、typecheck の前に必須。
install:
    bun install --frozen-lockfile

# 型チェック (cmux-msg は bun で src/cli.ts を直接実行するためコンパイル工程は無い)
typecheck: lint install
    bun run typecheck

# テスト
test: lint typecheck
    bun test

# Claude Plugin の構造検証
validate: lint
    claude plugin validate .

# 現在の version を表示 (3 ファイルの一致確認も兼ねる)
version:
    @bump-semver get {{ version-files }} --no-hint

# ---------- check recipes (push の sanity 検証、基本は push 経由でしか叩かない) ----------

# ワーキングコピーがクリーン (jj は @ が empty、git は porcelain 空。git/jj-agnostic, DR-0020)
ensure-clean: lint
    bump-semver vcs is clean

# 3 ファイル (plugin.json / marketplace.json / package.json) の version 一致を保証。
# bump-semver get は multi-file 時に内部で整合チェック (不一致は error 表示で exit 非 0)。
[private]
check-versions:
    @bump-semver get {{ version-files }} --no-hint >/dev/null

# push 成功直後の local 反映: 現セッションの marketplace + plugin を update し、
# /reload-plugins 依頼まで出す。push して終わりだと local Claude は古い plugin で
# 動き続けるため、push task に embed して仕組みで強制する。
[private]
_local-plugin-reload:
    claude plugin marketplace update cmux-msg
    claude plugin update cmux-msg@cmux-msg
    @echo ""
    @echo "[hint] /reload-plugins to apply in this session without restart"

# 翻訳ペア (NAME-ja.md / NAME.md) の整合性チェック
# timestamp 順序は vcs outdated で一括自動発見 (DR-0027)、相互リンクヘッダは個別 grep。
check-translations: ensure-clean check-translation-freshness (_check-translation-headers "README") (_check-translation-headers "docs/DESIGN") (_check-translation-headers "docs/MANUAL")

# 翻訳ペアの鮮度: en の最終 commit timestamp >= ja (= ja を更新したら en も更新する)。
# 対象は **/*-ja.md を自動発見 ($1=ディレクトリ, $2=basename)。git/jj-agnostic (DR-0027)。
[private]
check-translation-freshness:
    bump-semver vcs outdated 'glob:**/*-ja.md' '$1/$2.md'

# 相互リンクヘッダの確認 (vcs outdated は timestamp のみ検証するので grep は別途)。
# `?` sigil で -ja.md 不在時は recipe 全体を success として早期 return。
[private]
_check-translation-headers name:
    ?test -f {{ name }}-ja.md
    test -f {{ name }}.md
    head -5 {{ name }}-ja.md | grep -qF "> [English](./{{ file_name(name) }}.md) | 日本語"
    head -5 {{ name }}.md    | grep -qF "> English | [日本語](./{{ file_name(name) }}-ja.md)"

# product code に変更があれば version も main@origin より bump 済か検証 (変更なしならスキップ)。
# bump-semver vcs diff の exit code:
#   0 = bump-trigger-paths に変更なし → bump 不要
#   1 = 変更あり → version bump 済みかチェックに進む
# 3 = VCS error (main@origin 未 track 等) → 明示エラーで fetch を促す
[private]
[script]
check-version-bumped:
    rc=0
    bump-semver vcs diff -q main@origin -- {{ bump-trigger-paths }} || rc=$?
    case "$rc" in
      0) exit 0 ;;
      1) ;;
      *) echo "ERROR: bump-semver vcs diff failed (rc=$rc). main@origin が track されていない可能性。先に 'jj git fetch' を試してください" >&2; exit 1 ;;
    esac
    bump-semver compare gt .claude-plugin/plugin.json vcs:main@origin:.claude-plugin/plugin.json --no-hint && exit 0
    echo 'ERROR: bump-trigger-paths が変わってるが version 未 bump。"just bump-version" を実行してください' >&2
    exit 1
