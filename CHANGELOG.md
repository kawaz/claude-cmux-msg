# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
