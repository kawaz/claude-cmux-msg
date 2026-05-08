# cmux-msg

> English | [日本語](./README-ja.md)

A Claude Code plugin that provides file-based messaging between multiple Claude Code sessions running in [cmux](https://github.com/nichochar/cmux) (libghostty-based terminal) panes.

Two main use cases:

1. **AI ↔ AI communication** — a parent CC spawns worker CCs in new panes and exchanges messages with them via the file system.
2. **Reading AI conversations as a human** — every send/reply leaves an audit trail under `~/.local/share/cmux-messages/`, and `cmux-msg history` / `cmux-msg thread` reconstruct the conversation timeline. The bundled `cmux-msg.plugin.zsh` lets you drive these from your regular shell.

## Installation

```bash
# As a Claude Code plugin
claude plugin marketplace add kawaz/claude-cmux-msg
claude plugin install cmux-msg@cmux-msg
```

## Update

```bash
claude plugin marketplace update cmux-msg
claude plugin update cmux-msg@cmux-msg
```

## Identifiers

All commands address peers by **claude session UUID** — the value of `--session-id` passed to `claude`. `spawn` generates the child's UUID up front and starts `claude --session-id <uuid>`, so the parent knows the child's id immediately (no polling).

The session_id is resolved at command time:

1. `$CMUXMSG_SESSION_ID` (kept for the day Claude Code's `CLAUDE_ENV_FILE` mechanism actually works — Issue #15840)
2. **Working path today**: lookup `<ws>/by-surface/<CMUX_SURFACE_ID>` (written by the SessionStart hook)

Use `cmux-msg peers` to list peers and their session IDs (alive only by default; `--all` shows dead too).

## Quick start

```bash
# In a parent CC pane: spawn a worker in /path/to/project
$ cmux-msg spawn worker-a --cwd /path/to/project
spawn完了: id=1d033978-acf7-479b-b355-160ec85217b1 name=worker-a color=red

# Send a task to the worker
$ cmux-msg send 1d033978-acf7-479b-b355-160ec85217b1 "Refactor src/foo.ts"

# Receive the reply via Monitor + cmux-msg subscribe (see below)
# Once a notification arrives:
$ cmux-msg list
$ cmux-msg read <filename>

# After several round-trips, see what you and the worker actually said:
$ cmux-msg history
2026-05-07T12:11:05 → 1d033978  [request]   Refactor src/foo.ts ...           (sent/...)
2026-05-07T12:12:30 ← 1d033978  [response]  Done. Extracted helper into ...   (inbox/...)

# Or focus on a single thread (parent + replies)
$ cmux-msg thread 20260507T121105-...md

# Stop the worker when done
$ cmux-msg stop 1d033978-acf7-479b-b355-160ec85217b1
```

## Commands

| Command | Description |
|---------|-------------|
| `spawn [name] [--cwd path] [--args claude-args]` | Spawn a child CC in a new split pane |
| `stop <session_id>` | Stop a child CC and close its pane |
| `whoami` | Show your own session info |
| `peers [--all]` | List peers in the same workspace (alive only by default) |
| `send <session_id> <message>` | Send a message |
| `broadcast <message>` | Broadcast to all peers |
| `list` | List inbox messages |
| `read <filename>` | Display message content |
| `accept <filename>` | Accept message → `accepted/` |
| `dismiss <filename>` | Discard message → `archive/` |
| `reply <filename> <body>` | Reply and archive (internally accepts first, no separate `accept` needed) |
| `subscribe` | Stream inbox events as JSONL to stdout (meant for Monitor tool) |
| `history [--peer <session_id>] [--limit N]` | Time-merged display of inbox/accepted/archive/sent |
| `thread <filename>` | Walk `in_reply_to` chains forward and backward to render a conversation |
| `tell <session_id> <text>` | Send raw text to a pane (bypasses messaging) |
| `screen [session_id]` | Read pane screen content |
| `gc [--force]` | Remove dead session directories whose `inbox/` and `accepted/` are both empty (dry-run by default; `--force` actually deletes — note this also removes `archive/` and `sent/` of those sessions) |

Run `cmux-msg help` for the full help.

## How it works

- Messages are markdown files with frontmatter, stored under `~/.local/share/cmux-messages/<workspace>/<session_id>/inbox/`.
- Atomic delivery: write to `tmp/`, then rename into the recipient's `inbox/`.
- Notification via `cmux wait-for` signals (`cmux-msg:<session_id>`).
- **Sender's own copy**: `send` also creates a hardlink under the sender's `sent/` directory, so the sender can later inspect what they sent (and see the recipient's `read_at` / `response_at` updates from the same inode).
- **Per-directory README.md**: each layer (`~/.local/share/cmux-messages/`, `<workspace>/`, `<session>/`) gets a README.md symlink pointing at `.docs/latest/data-layout-*.md`. When you cd into a UUID-named directory and `ls`, you can `cat README.md` to remind yourself what that layer is.
- Spawned workers are auto-initialized via the SessionStart hook, which also auto-builds `bin/cmux-msg-bin` (compiled binary) on first run. The shell wrapper at `bin/cmux-msg` falls back to `bun run src/cli.ts` if the compiled binary is unavailable.
- The SessionStart hook writes `<ws>/by-surface/<CMUX_SURFACE_ID>` so any later `cmux-msg` invocation in this surface can look up its session_id without env propagation. (`$CLAUDE_ENV_FILE` is also written for forward compatibility but is not relied upon — Issue #15840.)
- Same-workspace peers are mutually trusted: `spawn` adds `--add-dir <MSG_BASE>/<workspace>` so child CCs can read/write each other's inbox/sent/etc. without sandbox EPERM. See `docs/decisions/DR-0002-sandbox-and-peer-listing.md` for the threat model.

## Receiving messages (recommended pattern)

Use Claude Code's **Monitor** tool with `cmux-msg subscribe`:

```
Monitor({
  command: "cmux-msg subscribe",
  description: "cmux-msg inbox",
  persistent: true
})
```

> **Important**: `cmux-msg subscribe` is a long-running blocking command. Do not call it from the Bash tool directly — it will hang. Always start it via Monitor.

- Each stdout line is a JSON object describing one unread message (`filename`, `from`, `priority`, `type`, `created_at`, `in_reply_to`).
- Existing unread messages are re-emitted every time `subscribe` starts, so resume-after-exit does not lose messages.
- The file itself stays in `inbox/` until you `accept`, `dismiss`, or `reply` it — the JSONL event is only a notification.

## Reading conversations after the fact

Use `cmux-msg history` and `cmux-msg thread` to reconstruct what was said:

```bash
# All messages I sent/received, time-merged
$ cmux-msg history

# Just my conversation with one peer
$ cmux-msg history --peer 1d033978-acf7-479b-b355-160ec85217b1

# A single in_reply_to chain
$ cmux-msg thread 20260507T121105-653b5fba.md
```

`history` walks `inbox/`, `accepted/`, `archive/`, and `sent/` together and sorts by `created_at`, marking each line with `→` (sent) or `←` (received). `thread` follows the `in_reply_to` field both backward (parents) and forward (children).

## Parallel spawning

`spawn` waits up to ~30s for the Claude prompt to appear (typically much less). To start multiple workers without serial waits, run them in parallel:

```bash
cmux-msg spawn task-a --cwd /path/A &
cmux-msg spawn task-b --cwd /path/B &
cmux-msg spawn task-c --cwd /path/C &
wait
```

## Using from a regular shell (zsh)

The plugin ships with `cmux-msg.plugin.zsh` so you can drive cmux-msg from your interactive shell as well — handy for inspecting AI conversations post-hoc with `cmux-msg history` / `cmux-msg thread`.

```bash
# zinit
zinit light kawaz/claude-cmux-msg

# antidote
echo 'kawaz/claude-cmux-msg' >> ~/.zsh_plugins.txt

# manual
source /path/to/claude-cmux-msg/cmux-msg.plugin.zsh
```

The plugin sets up an alias to the bundled `bin/cmux-msg` wrapper (which exec's the compiled `bin/cmux-msg-bin` when present, otherwise falls back to `bun run src/cli.ts`). It also adds `completions/` to `fpath` for tab completion of subcommands and options.

## License

MIT License
