# cmux-msg

A Claude Code plugin that provides file-based messaging between multiple Claude Code sessions running in [cmux](https://github.com/nichochar/cmux) (libghostty-based terminal) panes.

Designed for AI-to-AI communication: parent CC spawns worker CCs in new panes, then exchanges messages with them via the file system.

## Installation

```bash
claude plugin marketplace add kawaz/claude-cmux-msg
claude plugin install cmux-msg@cmux-msg
```

## Update

```bash
claude plugin marketplace update cmux-msg
claude plugin update cmux-msg@cmux-msg
```

## Identifiers

All commands address sessions by **UUID** (the value of `CMUX_SURFACE_ID`, e.g. `1D033978-ACF7-479B-B355-160EC85217B1`).
Use `cmux-msg peers` to list peers and their UUIDs.

The cmux-internal `surface:N` reference is hidden from the user interface.

## Quick start

```bash
# In a parent CC pane: spawn a worker in /path/to/project
$ cmux-msg spawn worker-a --cwd /path/to/project
spawn完了: id=1D033978-ACF7-479B-B355-160EC85217B1 name=worker-a color=red

# Send a task to the worker
$ cmux-msg send 1D033978-ACF7-479B-B355-160EC85217B1 "Refactor src/foo.ts"

# Stream inbox events as JSONL (for use with Claude Code's Monitor tool)
$ cmux-msg subscribe
{"filename":"2026-04-21T...-abcd.md","from":"1D03...","priority":"normal","type":"response","created_at":"2026-04-21T12:34:56Z","in_reply_to":"..."}

# Read the reply
$ cmux-msg list
$ cmux-msg read <filename>

# Stop the worker when done
$ cmux-msg stop 1D033978-ACF7-479B-B355-160EC85217B1
```

## Commands

| Command | Description |
|---------|-------------|
| `spawn [name] [--cwd path] [--args claude-args]` | Spawn a child CC in a new split pane |
| `stop <uuid>` | Stop a child CC and close its pane |
| `whoami` | Show your own session info |
| `peers` | List peers in the same workspace |
| `send <uuid> <message>` | Send a message |
| `broadcast <message>` | Broadcast to all peers |
| `list` | List inbox messages |
| `read <filename>` | Display message content |
| `accept <filename>` | Accept message → `accepted/` |
| `dismiss <filename>` | Discard message → `archive/` |
| `reply <filename> <body>` | Reply and archive |
| `subscribe` | Stream inbox events as JSONL to stdout (meant for Monitor tool) |
| `tell <uuid> <text>` | Send raw text to a pane (bypasses messaging) |
| `screen [uuid]` | Read pane screen content |

Run `cmux-msg help` for the full help.

## How it works

- Messages are markdown files with frontmatter, stored under `~/.local/share/cmux-messages/<workspace>/<uuid>/inbox/`.
- Atomic delivery via tmp + rename.
- Notification via `cmux wait-for` signals (`cmux-msg:<uuid>`).
- Spawned workers are automatically initialized via the SessionStart hook, which also auto-builds `bin/cmux-msg` on first run if missing.

## Receiving messages (recommended pattern)

Use Claude Code's **Monitor** tool with `cmux-msg subscribe`:

```
Monitor({
  command: "cmux-msg subscribe",
  description: "cmux-msg inbox",
  persistent: true
})
```

- Each stdout line is a JSON object describing one unread message (filename, from, priority, type, created_at, in_reply_to).
- Existing unread messages are re-emitted every time `subscribe` starts, so resume-after-exit does not lose messages.
- The file itself stays in `inbox/` until you `accept`, `dismiss`, or `reply` it — the JSONL event is only a notification.

## Parallel spawning

`spawn` waits ~30s for Claude prompt detection. To start multiple workers, run them in parallel:

```bash
cmux-msg spawn task-a --cwd /path/A &
cmux-msg spawn task-b --cwd /path/B &
cmux-msg spawn task-c --cwd /path/C &
wait
```

## License

MIT License
