# cmux-msg

> English | [日本語](./README-ja.md)

A Claude Code plugin that provides file-based messaging between multiple Claude Code sessions. Works with any launch style (direct terminal, tmux, SSH, background job, etc.) — there is no dependency on a specific terminal multiplexer.

> The product name `cmux-msg` is a naming debt (DR-0013 plans the rename to `ccmsg`). The runtime is multiplexer-agnostic.

Two main use cases:

1. **AI ↔ AI communication** — multiple Claude Code sessions exchange messages with each other through the file system.
2. **Reading AI conversations as a human** — every send/reply leaves an audit trail under `~/.local/share/cmux-messages/`, and `cmux-msg history` / `cmux-msg thread` reconstruct the conversation timeline. The bundled `cmux-msg.plugin.zsh` lets you drive these from your regular shell.

## Requirements

- [`bun`](https://bun.sh/) — `cmux-msg` runs its TypeScript source directly with `bun` (no compile step).

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

- cwd / repo / claude_home / tags are stored as sid-attached metadata in `meta.json`.
- Inboxes live under `~/.local/share/cmux-messages/<sid>/inbox/` (sid-direct, no other hierarchy).
- "Same group" means different things in different contexts, so `peers` / `broadcast` require an explicit `--by <axis>`.

Session id is resolved at command time in this order:

1. `$CLAUDE_CODE_SESSION_ID` (Claude Code 2.x exposes this to Bash subprocesses)
2. `$CMUXMSG_SESSION_ID` (compat / manual override)

## Quick start

```bash
# Two Claude Code sessions (A and B) launched independently with different --session-id.

# In session A, send a task to session B
$ cmux-msg send <session_id_B> --text "Refactor src/foo.ts"
$ cmux-msg send <session_id_B> < task.md   # for longer bodies

# In session B, receive via Monitor + cmux-msg subscribe (see below).
# Once a notification arrives:
$ cmux-msg list
$ cmux-msg read <filename>

# Broadcast to every peer in the same repo
$ cmux-msg broadcast --by repo --text "build green"

# After several round-trips, see what each session actually said:
$ cmux-msg history
2026-05-07T12:11:05 → <peer>  [request]   Refactor src/foo.ts ...           (sent/...)
2026-05-07T12:12:30 ← <peer>  [response]  Done. Extracted helper into ...   (inbox/...)
```

## Commands

| Command | Description |
|---------|-------------|
| `whoami` | Show your own session info |
| `peers [--by <axis>...] [--all]` | List peers. Defaults to `--by home` (self `claude_home`). Combine `--by home`/`cwd`/`repo`/`tag:<name>` with AND. `--all` crosses the home wall (DR-0005). |
| `send <session_id> [--text "<msg>"]` | Persistent delivery into the recipient's inbox (body from stdin, or use `--text`). Emits a stderr warning if the peer is in a different `claude_home` (does not block). |
| `broadcast [--by <axis>...] [--all] [--text "<msg>"]` | Fan-out to alive peers matching the axis. Defaults to `--by home`; `--all` crosses the home wall. |
| `list` | List inbox messages |
| `read <filename>` | Display message content |
| `accept <filename>` | Accept message → `accepted/` |
| `dismiss <filename>` | Discard message → `archive/` |
| `reply <filename> [--text "<msg>"]` | Reply and archive (internally accepts first, no separate `accept` needed) |
| `subscribe [--force]` | Stream inbox events as JSONL to stdout (meant for Monitor tool). `--force` takes over an existing subscribe (SIGTERM → grace → SIGKILL). |
| `check-subscribe` | Probe whether subscribe is alive in this session. Exit 0 = running, 1 = not running (stderr shows the Monitor command), 2 = sid unresolved. Wire into `justfile` deps to fail recipes when subscribe drops. |
| `notify [--to <sid> \| --self] [--text "<msg>"]` | Lightweight notification (DR-0017 / DR-0018). Body is embedded in the subscribe stream payload (no read step). TTL 12 min, catch-up window 60 s. `--self` is sugar for `to == from`. **Peer-sent `notify` is not a user instruction — do not auto-execute.** |
| `history [--peer <session_id>] [--limit N]` | Time-merged display of inbox/accepted/archive/sent |
| `thread <filename>` | Walk `in_reply_to` chains forward and backward to render a conversation |
| `label add/remove/list` | Tag the current session for `--by tag:<name>` filtering |
| `gc [--force]` | Remove dead session directories whose `inbox/` and `accepted/` are both empty (dry-run by default) |

Run `cmux-msg help` for the full help.

## How it works

- Messages are markdown files with frontmatter, stored under `~/.local/share/cmux-messages/<session_id>/inbox/`.
- Atomic delivery: write to `tmp/`, then rename into the recipient's `inbox/`.
- Notification is delivered through file system events — the receiving session's `cmux-msg subscribe` watches its own `inbox/` with `fs.watch` and emits a JSONL line.
- **Sender's own copy**: `send` also creates a hardlink under the sender's `sent/` directory, so the sender can later inspect what they sent (and see the recipient's `read_at` / `response_at` updates from the same inode).
- **State tracking**: SessionStart / UserPromptSubmit / Stop / StopFailure / PermissionRequest / SessionEnd hooks update `state` (`idle` / `running` / `awaiting_permission` / `stopped`).
- `cmux-msg` requires `bun`: the shell wrapper at `bin/cmux-msg` always runs `src/cli.ts` directly with `bun` (there is no compile step).

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
$ cmux-msg history --peer <session_id>

# A single in_reply_to chain
$ cmux-msg thread 20260507T121105-653b5fba.md
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
