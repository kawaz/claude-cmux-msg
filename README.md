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

## Identifier model (DR-0004)

The primary key for messaging is **session_id (sid)** — the UUID v4 minted by `claude --session-id <uuid>`. Every inbox, sent log and state live keyed on sid.

- workspace / surface / cwd / repo / claude_home / tags are stored as sid-attached metadata in `meta.json`, not as directory hierarchy.
- Inboxes live under `~/.local/share/cmux-messages/<sid>/inbox/` (sid-direct, no workspace tier).
- "Same group" means different things in different contexts, so `peers` / `broadcast` require an explicit `--by <axis>`.

Session id is resolved at command time in this order:

1. `$CLAUDE_CODE_SESSION_ID` (Claude Code 2.x exposes this to Bash subprocesses)
2. `$CMUXMSG_SESSION_ID` (compat / manual override)
3. Lookup of `<base>/by-surface/<CMUX_SURFACE_ID>` (written by the SessionStart hook; works around Claude Code `CLAUDE_ENV_FILE` bug — Issue #15840)

## Quick start

```bash
# In a parent CC pane: spawn a worker in /path/to/project
$ cmux-msg spawn worker-a --cwd /path/to/project
spawn完了: id=1d033978-acf7-479b-b355-160ec85217b1 name=worker-a color=red

# Send a task to the worker (persistent)
$ cmux-msg send 1d033978-acf7-479b-b355-160ec85217b1 "Refactor src/foo.ts"

# Receive replies via Monitor + cmux-msg subscribe (see below).
# Once a notification arrives:
$ cmux-msg list
$ cmux-msg read <filename>

# Broadcast to every peer in the same repo
$ cmux-msg broadcast --by repo "build green"

# After several round-trips, see what you and the worker actually said:
$ cmux-msg history
2026-05-07T12:11:05 → 1d033978  [request]   Refactor src/foo.ts ...           (sent/...)
2026-05-07T12:12:30 ← 1d033978  [response]  Done. Extracted helper into ...   (inbox/...)

# Stop the worker when done
$ cmux-msg stop 1d033978-acf7-479b-b355-160ec85217b1
```

## Commands

| Command | Description |
|---------|-------------|
| `spawn [name] [--cwd path] [--args claude-args] [--tags csv]` | Spawn a child CC in a new split pane. `--tags csv` initializes the child's `meta.tags`. |
| `stop <session_id>` | Stop a child CC and close its pane |
| `whoami` | Show your own session info |
| `peers [--by <axis>...] [--all]` | List peers. Defaults to `--by home` (self `claude_home`). Combine `--by home`/`ws`/`cwd`/`repo`/`tag:<name>` with AND. `--all` crosses the home wall (DR-0005). |
| `send <session_id> <message>` | Persistent delivery into the recipient's inbox. Emits a stderr warning if the peer is in a different `claude_home` (does not block). |
| `broadcast [--by <axis>...] [--all] <message>` | Fan-out to alive peers matching the axis. Defaults to `--by home`; `--all` crosses the home wall. |
| `list` | List inbox messages |
| `read <filename>` | Display message content |
| `accept <filename>` | Accept message → `accepted/` |
| `dismiss <filename>` | Discard message → `archive/` |
| `reply <filename> <body>` | Reply and archive (internally accepts first, no separate `accept` needed) |
| `subscribe` | Stream inbox events as JSONL to stdout (meant for Monitor tool) |
| `history [--peer <session_id>] [--limit N]` | Time-merged display of inbox/accepted/archive/sent |
| `thread <filename>` | Walk `in_reply_to` chains forward and backward to render a conversation |
| `tell <session_id> <text>` | Send raw text to a pane. Requires the peer to be foreground AND state ∈ {idle, awaiting_permission} (DR-0004). |
| `screen [session_id]` | Read pane screen content. Requires the peer to be foreground. |
| `gc [--force]` | Remove dead session directories whose `inbox/` and `accepted/` are both empty (dry-run by default) |

Run `cmux-msg help` for the full help.

## How it works

- Messages are markdown files with frontmatter, stored under `~/.local/share/cmux-messages/<session_id>/inbox/`.
- Atomic delivery: write to `tmp/`, then rename into the recipient's `inbox/`.
- Notification via `cmux wait-for` signals (`cmux-msg:<session_id>`).
- **Sender's own copy**: `send` also creates a hardlink under the sender's `sent/` directory, so the sender can later inspect what they sent (and see the recipient's `read_at` / `response_at` updates from the same inode).
- **State tracking**: SessionStart / UserPromptSubmit / Stop / StopFailure / PermissionRequest / SessionEnd hooks update `state` (`idle` / `running` / `awaiting_permission` / `stopped`). `tell` consults this so it only injects input when it is safe.
- Spawned workers are auto-initialized via the SessionStart hook, which also auto-builds `bin/cmux-msg-bin` (compiled binary) on first run. The shell wrapper at `bin/cmux-msg` falls back to `bun run src/cli.ts` if the compiled binary is unavailable.
- The SessionStart hook writes `<base>/by-surface/<CMUX_SURFACE_ID>` so any later `cmux-msg` invocation in this surface can resolve its session_id without env propagation.
- Same-workspace peers are mutually trusted: `spawn` adds `--add-dir <MSG_BASE>` so child CCs can read/write each other's inbox/sent/etc. without sandbox EPERM. See `docs/decisions/DR-0002-sandbox-and-peer-listing.md` for the threat model.

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

- Each stdout line is a JSON object describing one unread message.
- Existing unread messages are re-emitted every time `subscribe` starts, so resume-after-exit does not lose messages.
- The file itself stays in `inbox/` until you `accept`, `dismiss`, or `reply` it — the JSONL event is only a notification.

### Fallback: Unread notification via the UserPromptSubmit hook

As a safety net for when Monitor was not started, the `UserPromptSubmit` hook (auto-registered by this plugin) reports unread messages on the next turn. It does **not** fire mid-turn — for real-time delivery use `Monitor + subscribe`.

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

## License

MIT License
