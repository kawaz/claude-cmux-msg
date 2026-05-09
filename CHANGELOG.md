# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.25.0] - 2026-05-09

### Added

- `cmux-msg send <id>` が **stdin / `--file` から本文を読めるように**。長文 heredoc を `$(cat)` 経由でラップする手間が不要に。`--file -` で stdin、`--file <path>` でファイル指定。引数省略時は非 TTY なら自動で stdin から読み込み (TTY なら usage error)。`docs/issue/2026-05-09-send-cannot-read-stdin.md`
- `cmux-msg spawn` の出力に **Claude Code リモート操作 URL** (`https://claude.ai/code/session_XXX`) を含めるように。spawn 直後に screen をサンプリングして抽出。取得失敗しても spawn は成功扱い。`--json` で `{id, name, color, surface_ref, remote_url}` を 1 行 JSON 出力。`docs/issue/2026-05-09-spawn-output-missing-remote-url.md`
- **UserPromptSubmit hook** を新規追加。ユーザがプロンプトを送信するたびに inbox/ を覗き、未読があれば `<system-reminder>` として Claude のコンテキストに injection。Monitor + `cmux-msg subscribe` を張り忘れた場合の safety net として機能 (リアルタイム性は subscribe 任せ)。`docs/issue/2026-05-09-inbox-no-active-notification.md`
- `docs/runbooks/spawn-troubleshooting.md` を新規作成。spawn 完了表示は出るが session が永続化されないケースの切り分け手順。
- `docs/findings/2026-05-09-claude-slash-command-detection-feasibility.md`: Claude Code ビルトイン slash command (`/rename` `/color`) の検知可能性調査結果を集約。

### Changed

- **`cmux-msg spawn` の引数パースを堅牢化** (破壊的変更):
  - `--help` / `-h` を最優先で処理して return (副作用なくヘルプ表示)
  - 引数なし `cmux-msg spawn` は副作用なくヘルプ表示 (旧: 自動 name で session を起こしていた)
  - 不明なフラグはエラー (旧: `--help` を name に消費して session を起こしていた)
  - 位置引数は最初の non-option のみ name として採用
  - `docs/issue/2026-05-09-spawn-args-consume-cli-flags.md`
- **`cmux-msg spawn` の通常出力フォーマット変更** (破壊的変更): 1 行 `id=... name=... color=...` から複数行 `key: value` 形式に。`--json` モードを追加。
- spawn の signal タイムアウト警告メッセージに `peers --all` / `gc` / runbook へのヒントを追加。
- `src/hooks/session-start.ts` の `main().catch` をエラー握り潰しから stderr 出力に変更し、デバッグログから原因解析できるように (spawn-claude-not-launching の調査用)。
- `src/hooks/session-start.ts` の親 CC 用メッセージを「Monitor + subscribe を必ず張れ」と強い文言に変更。
- `README-ja.md` に「補完: UserPromptSubmit hook による未読通知」節を追加。peers コマンド行に「name は `/rename` 後も追従しない」注記。
- `docs/ROADMAP.md` の「諦めた / 別件」に `/rename` `/color` の peers 反映不可を追加 (Claude Code 側に検知 hook / API がないため)。

### Documentation

- `docs/journal/2026-05-09-self-improvement-batch.md` 新設。本リリースで対応した self-improvement の経緯・判断・残課題を集約。

## [0.22.1] - 2026-05-08

### Documentation
- `~/.local/share/cmux-messages/.docs/` の説明を **ユーザ視点に書き換え**。
  - 旧: `.docs/v<version>/` `latest → v<version> (バージョン bump で付け替え)` のように内部実装を露出していた
  - 新: `.docs/` を「README.md の参照先 (cmux-msg プラグイン管理、触らない)」と一行で説明。バージョン管理は内部実装なのでユーザに見せない
- `data-layout-root.md` 内に残っていた旧ファイル名 `layout-root.md` の参照を削除 (各階層 README は「この文書を指す symlink」と簡潔に)

## [0.24.0] - 2026-05-08

### Changed (docs 命名規則)

- docs 直下の標準ドキュメントを **大文字化**: `STRUCTURE.md` (旧 `structure.md`)、`ROADMAP.md` (旧 `roadmap.md`)。`README.md` の Unix 慣例と整合し、サブディレクトリ (小文字) との視覚区別が明確になる。
- 全サブディレクトリのファイル命名を **`YYYY-MM-DD-<slug>.md` 必須**に統一 (`research/` `findings/` `journal/` `knowledge/` `runbooks/` `issue/` `archive/`)。例外は `decisions/DR-NNNN-title.md` と `design/` 配下の付随ファイル。理由: 数が増えた時に気付きやすい、jj/git の commit timestamp は rebase で揺れるためファイル名側に作成日を持つほうが信頼できる。
- 相互リンクの位置を **タイトル直下**に変更（旧: 末尾）。末尾だと存在に気付きにくいため。テンプレ:
  - 英語版: `> English | [日本語](./README-ja.md)`
  - 日本語版: `> [English](./README.md) | 日本語`
- `check-translations` を **先頭 5 行のみ** で grep するよう変更。タイトル直下を強制する。`MANUAL.md` も対象に追加（OSS 必須対象は README/DESIGN/MANUAL）。

## [0.23.0] - 2026-05-08

### Added

- `docs/journal/` 新設。日々の生記録 (ハマり所 → 解決策のペア、コマンド・設定値) を `YYYY-MM-DD-topic.md` で残す。non-stop 作業や長時間セッションの後、膨大なログより journal を読み返す方が状況復元しやすい (zunsystem の業務リポジトリでの運用実績を参考)。
  - `docs/journal/2026-05-08-docs-structure-and-design-priority.md` を 1 件目として追加 (本セッションの docs 構造議論と設計優先度ルールの確立経緯を記録)。
- `docs/issue/` 新設。自プロジェクト内 TODO + 上流ライブラリへの要望を置く。解決時は削除 (jj/git 履歴で追える、`done/` 移動はしない)。
- `docs/STRUCTURE.md` に kawaz/* 横断の docs 構造ルール (`~/.claude/rules/docs-structure.md`) への参照を追記。

### Documentation
- 横展開ルール `~/.claude/rules/docs-structure.md` を新設 (個人ルールなのでこのリポジトリ外)。kawaz/claude-cmux-msg を参考実装と位置付け、命名規則・サブディレクトリ採用条件・言語ポリシー・既存リポマイグレーション方針などを集約。

## [0.22.0] - 2026-05-08

### Changed (docs 大規模整理)

`docs/` 構成を kawaz/* 横断のルールに沿って整理:

- `docs/decisions/` 新設、DR を `DR-NNNN-title.md` 形式 (4 桁 0-padding) に統一
  - 旧: `docs/design/2026-04-23-session-id-identifier.md` → 新: `docs/decisions/DR-0001-session-id-identifier.md`
  - 旧: `docs/design/2026-05-07-sandbox-and-peer-listing.md` → 新: `docs/decisions/DR-0002-sandbox-and-peer-listing.md`
  - `docs/decisions/INDEX.md` 新設 (DR 一覧)
- `docs/layout/` を `docs/design/data-layout-{root,workspace,session}.md` に改名・移動
  - `src/lib/layout-docs.ts` の `LAYOUT_FILES` と参照パスも追従
- `docs/STRUCTURE.md` 新設 (リポジトリ物理構造)
- `docs/ROADMAP.md` 新設 (将来検討項目: CLI parser 統一、subscribe SIGINT 累積、peers death since、broadcast 意味論再設計、reply トランザクション拡充など)

### Added

- `README-ja.md` (日本語原本)。`README.md` (英語) と相互リンク
- `justfile` に `check-translations` と `ensure-clean` を追加、`push` / `push-without-bump` の依存に組み込み
  - `check-translations`: `{BASE}-ja.md` と `{BASE}.md` の両方が存在することと、相互リンクが互いに張られていることを確認。`git log` の commit timestamp で `-ja` が新しすぎないか比較 (古い英語版のまま push できないようにする)
  - `ensure-clean`: working copy に未確定変更が無いことを確認 (describe 忘れ防止)

## [0.21.0] - 2026-05-07

### Changed
- `setupLayoutDocs` が `.docs/v<version>/` の存在チェックではなく **content hash 比較** で再コピー判断するよう変更。同じ version でも plugin 内 `docs/layout/*.md` を更新したら自動で `.docs/v<version>/` 側も更新される (開発中の同 version 編集ケース、#19 対応)。
- `just check-versions` が `package.json` のバージョン整合も検証するよう拡張。`just version-bump` は plugin/marketplace/package を同期更新しているが、check が plugin/marketplace のみだった取り残しを解消 (#33 対応)。

### Documentation
- `skills/cmux-msg/SKILL.md` に「sent/ の inode 共有が崩れるケース」を追記 (atomic save / クロス FS / `rm` 時の挙動)。0.15.0 で hardlink fallback を廃止した経緯と合わせて、運用上の前提を明文化 (#11 対応)。

## [0.20.0] - 2026-05-07

### Added
- `cmux-msg gc --verbose` で保持された peer の理由 (`self` / `alive` / `inbox に残メッセージ` / `accepted に残メッセージ`) を表示。掃除されない peer の診断に使える (#32 対応)。

### Changed
- CLI のサブコマンドディスパッチを `switch` 文から `Record<string, handler>` テーブルに変更。`peers`/`ls-peers`、`list`/`ls` などの alias は同じハンドラを別キーで指すだけになり、重複ロジックを排除 (#34 対応)。
- `cmuxExec` の例外捕捉で `e instanceof Error ? e.message : String(e)` を使うよう修正。`Error` の場合に `message` だけ取り出すことで呼び出し側が parse しなくて済む (#31 対応)。

## [0.19.0] - 2026-05-07

### Added
- `broadcast_id` フィールドをメッセージ frontmatter に追加。1 回の `cmux-msg broadcast` 実行で送られる N 件のメッセージは全部同じ `broadcast_id` (UUID) を持つ。受信側は peer 横断で「同じ broadcast の一部」を同定可能 (#3 対応)。
- `MessageMeta` / `InboxMessage` / `MessageRecord` に `broadcast_id` を追加。`history --json` 出力にも含まれる。

### Changed
- `cmux-msg spawn` の Claude Code 起動完了検出を文字列マッチから signal 駆動に変更。子CC の `SessionStart` hook が `cmux-msg:spawned-<sid>` を発信し、親 (spawn コマンド) は `cmux wait-for` で待機する。Claude Code のバージョンで表示文字列が変わっても壊れない (#14 対応)。

### Fixed
- `replyMessage` を冪等にした。`accepted/<filename>` に `response_at` が既に書かれている場合 (前回の reply で送信は完了し archive 移動だけ失敗した状態) は二重送信せず、archive 移動だけ完了させて警告を返す (#24 対応)。
- `cmux-msg broadcast` も `UsageError` 経由のエラー処理に統一 (`process.exit(1)` 直書きの取り残し)。

## [0.18.0] - 2026-05-07

### Changed (refactor)
- `src/lib/message.ts` (258 行、3 系統の関心事が同居していた) を 3 ファイルに分離:
  - `src/lib/sender.ts` — `sendMessage` (送信)
  - `src/lib/inbox.ts` — `listInbox` / `readMessage` / `countInbox` (受信読み出し)
  - `src/lib/transition.ts` — `acceptMessage` / `dismissMessage` / `replyMessage` (状態遷移)
- `transition.ts` に共通の `transitionMessage(filename, fromDir, toDir, fields)` を導入し、accept / dismiss / reply 内の rename + frontmatter 追記の重複を解消。
- `MSG_BASE` 定数を完全廃止。`getMsgBase()` 関数経由に統一し、テスト時の env 切替がすべての利用箇所に反映されるようにした (二重提供だった負債を解消)。
- `getMsgBase` を `src/lib/paths.ts` に独立。`session-index.ts` の env 直読みも `paths.ts` 経由に切り替え、`config.ts` ↔ `session-index.ts` の循環依存懸念を構造的に断った。

### Added
- `src/lib/message.test.ts` — sender / inbox / transition の統合テスト (17 件)。リファクタの safety net として、送信・受信・accept・dismiss・reply・ラウンドトリップの不変条件を担保。

## [0.17.0] - 2026-05-07

### Changed
- `spawn` magic numbers extracted into named constants (`PROMPT_POLL_INTERVAL_MS`, `PROMPT_WAIT_MAX_SEC`, `SLASH_COMMAND_SETTLE_MS`).
- `spawn` peer-count enumeration now uses `listPeers` (consolidated in 0.12.0) instead of re-implementing the `isSessionId` filter inline.
- `subscribe` `cmux wait-for` timeout (default 1h) is now overridable via `CMUXMSG_SUBSCRIBE_TIMEOUT` (seconds).
- `ensureSymlink` tmp suffix now includes 8 random hex chars in addition to PID+timestamp, so concurrent invocations within the same millisecond from the same PID won't clash.

## [0.16.0] - 2026-05-07

### Security
- `spawn` now `shellSingleQuote`s every value substituted into the `cmuxSend`'d command line (`name`, `cwd`, `surfaceRef`, `parentSessionId`, `childSessionId`, `pluginRoot`, `msgWsDir`). The previous implementation interpolated some values raw, so a `--cwd '$(rm -rf ~)'` would have been executed during command substitution. `claudeArgs` is intentionally left unquoted (it's the user-supplied flag string), but the documented expectation is that the user is the only caller (personal-tool threat model).
- `validateName` switched from a blacklist to a strict whitelist (`[a-zA-Z0-9_-]+`). Japanese / spaces / quoting characters / `..` / `*` etc. are now rejected. Workers' display names should remain ASCII-safe; localized labels can be added later via a separate non-shell-bound metadata field.

### Changed
- `shortId()` and `TYPE_LABEL_WIDTH` extracted into `src/lib/format.ts`; `history.ts` and `thread.ts` no longer duplicate the implementation. Adding a new `type` longer than `broadcast` will widen `TYPE_LABEL_WIDTH` automatically.
- `cmux-msg history --peer <id>` now `validateSessionId`s its argument instead of silently returning empty.
- `cmux-msg thread` errors are thrown to `cli.ts` (consistent with `0.15.0`'s error-handling cleanup).

## [0.15.0] - 2026-05-07

### Changed
- Error handling unified: each command no longer wraps its body in a redundant `try { ... } catch { console.error; process.exit(1) }`. A new `UsageError` class lets argument-parsing errors print just the usage line, while other errors are caught at `cli.ts` and printed with an `エラー:` prefix.
- `nowIso()` now emits ISO 8601 with timezone offset (e.g. `2026-05-07T12:34:56+09:00`). Frontmatter `created_at` / `read_at` etc. are now unambiguous across machines, addressing the "messages from the future" issue when `history --json` output is processed elsewhere.
- `getProcessStartTime()` now invokes `ps` with `LC_ALL=C` / `LANG=C` to avoid locale-dependent `lstart` strings (Japanese weekday name was breaking the `pid` file `lstart` comparison).
- `init` writes the `pid` file via `tmp + rename` so other processes never read a half-written entry mid-update.
- `subscribe` no longer calls `process.exit(1)` on `cmux wait-for` failure — it throws and lets `cli.ts` handle the exit code, matching the rest of the codebase.

### Fixed
- `broadcast` no longer silently swallows partial failures. Each rejection is logged to stderr with the peer ID and reason, and the process exits with code 2 on partial failure (code 0 = all sent, code 1 = total error, code 2 = partial).
- `sendMessage` no longer falls back to a `writeFileSync` copy when `link()` fails (cross-FS etc.). Such a fallback violated the documented invariant that `sent/` shares an inode with the recipient's `inbox/`. We now emit a stderr warning and skip the `sent/` record instead of producing a misleading separate file.
- `pluginRoot()` now prints a stderr warning when it falls back to `process.cwd()`, instead of silently returning a possibly wrong directory.

### Documentation
- `gc` is now documented in README.md and SKILL.md (including the warning that `--force` also removes `archive/` and `sent/` of the targeted sessions).

## [0.14.0] - 2026-05-07

### Added
- `cmux-msg history --json` — JSONL output for machine-readable consumption (one line per message, full record including body).
- `cmux-msg thread <filename> --json` — JSON array output for the entire thread.

## [0.13.0] - 2026-05-07

### Added
- `cmux-msg gc [--force]` — clean up dead session directories whose `inbox/` and `accepted/` are both empty. Dry-run by default. Sessions with pending messages are preserved.

### Changed
- `cmux-msg subscribe` now writes a stderr warning when started in a TTY. Foreground use blocks indefinitely; the recommended invocation is via Claude Code's Monitor tool. The warning does not interfere with the JSONL stream on stdout.

## [0.12.1] - 2026-05-07

### Fixed
- `isPeerAlive` no longer mistakenly reports a dead peer as alive when its PID has been reused. The `pid` file now records `<pid>\n<lstart>` (process start time from `ps -o lstart=`) and `isPeerAlive` requires both PID liveness and `lstart` match. Old single-line `pid` files are treated as dead until the session re-initializes.

## [0.12.0] - 2026-05-07

### Changed
- `peer` listing / liveness logic consolidated into `src/lib/peer.ts` (`isProcessAlive` / `isPeerAlive` / `listPeers`). Both `peers` and `broadcast` now use the same code path.
- `broadcast` now filters out dead peers (previously it sent to every directory under the workspace, including dead sessions and the `by-surface` index).

## [0.11.0] - 2026-05-07

### Changed
- `bin/cmux-msg` is now a Bash wrapper script (committed) that exec's `bin/cmux-msg-bin` (compiled, gitignored) when present, otherwise falls back to `bun run src/cli.ts`. CC-side hook and shell users both call the same `bin/cmux-msg`.
- `cmux-msg.plugin.zsh` simplified to alias the bundled `bin/cmux-msg`. Works for bash/zsh/fish.
- `pluginRoot()` resolves correctly when invoked as `bun run src/cli.ts` (uses `argv[1]`).

## [0.10.0] - 2026-05-07

### Added
- `cmux-msg.plugin.zsh` — zsh plugin that lets users drive cmux-msg from their interactive shell.
- `completions/_cmux-msg` — zsh completion for major subcommands and options.
- Unit tests for `history.ts` (8 tests).

### Changed
- `skills/cmux-msg/SKILL.md` updated for 0.7.0–0.9.0 features.
- SessionStart hook spawned-worker context strengthened: subscribe must be invoked via Monitor (Bash direct call hangs), `accept` is unnecessary before `reply`.
- `MSG_BASE` exposed as a function (`getMsgBase()`) so tests can inject `CMUXMSG_BASE`.

## [0.9.0] - 2026-05-07

### Added
- `<session_id>/sent/` directory: every `send` / `reply` / `broadcast` records a hardlink under the sender's `sent/` so the sender can later inspect what they sent. Hardlink (not copy) so the recipient's later frontmatter updates (`read_at` / `response_at` / `archive_at`) become visible from the sender's `sent/` too.
- `cmux-msg history [--peer <id>] [--limit N]` — time-merged view of inbox/accepted/archive/sent.
- `cmux-msg thread <filename>` — walks `in_reply_to` backwards and forwards for conversation reconstruction.

## [0.8.0] - 2026-05-07

### Added
- Per-layer `README.md` symlinks under `~/.local/share/cmux-messages/`. Three levels (root / workspace / session) each get a `README.md` pointing at `.docs/latest/layout-*.md`. Auto-deployed by SessionStart hook. Solves "I cd'd into a UUID directory and have no idea what it represents".

## [0.7.0] - 2026-05-07

### Changed
- `peers` lists alive sessions only by default; `--all` shows dead sessions too.
- `peers` and `spawn` now filter directory entries by UUID v4 pattern (`isSessionId`), so non-session entries like `by-surface/` are excluded from peer enumeration.

### Fixed
- Spawn now passes `--add-dir <MSG_BASE>/<workspace>` to `claude` so child CCs can read/write `~/.local/share/cmux-messages/...` (without this, `reply`/`accept` failed with EPERM under Claude Code's sandbox). See `docs/decisions/DR-0002-sandbox-and-peer-listing.md` for the threat model behind this trust decision.

## [0.6.0] - 2026-04-28

### Changed
- BREAKING: switched `session_id` resolution from `CLAUDE_ENV_FILE` to `<ws>/by-surface/<CMUX_SURFACE_ID>` lookup file (workaround for claude-code Issue #15840).

## Earlier

See git log for changes before 0.6.0.
