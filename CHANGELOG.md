# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Spawn now passes `--add-dir <MSG_BASE>/<workspace>` to `claude` so child CCs can read/write `~/.local/share/cmux-messages/...` (without this, `reply`/`accept` failed with EPERM under Claude Code's sandbox). See `docs/design/2026-05-07-sandbox-and-peer-listing.md` for the threat model behind this trust decision.

## [0.6.0] - 2026-04-28

### Changed
- BREAKING: switched `session_id` resolution from `CLAUDE_ENV_FILE` to `<ws>/by-surface/<CMUX_SURFACE_ID>` lookup file (workaround for claude-code Issue #15840).

## Earlier

See git log for changes before 0.6.0.
