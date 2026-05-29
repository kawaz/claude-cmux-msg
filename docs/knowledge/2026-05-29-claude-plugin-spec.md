# Claude Code Plugin / Skill / Hooks — 公式仕様リファレンス

このドキュメントは、Claude Code 公式ドキュメントから抽出した、plugin・skill・hooks の技術仕様を体系的にまとめています。**確証ある記述のみを含む**ため、出典 URL と spec 保証範囲を明示します。

Source: https://code.claude.com/docs/en/{plugins,skills,hooks-guide,plugins-reference,hooks}.md  
Last updated: 2026-05-29

---

## 1. Plugin 全体構造

### 1.1 ディレクトリレイアウト

出典: [Plugins reference / Plugin directory structure](https://code.claude.com/docs/en/plugins-reference.md#plugin-directory-structure)

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json          (Optional manifest)
├── skills/
│   ├── skill-a/
│   │   ├── SKILL.md         (required)
│   │   ├── reference.md     (optional supporting file)
│   │   └── scripts/         (optional supporting dir)
│   └── skill-b/
│       └── SKILL.md
├── commands/                (Legacy: use skills/ for new plugins)
├── agents/
│   └── agent-name.md
├── hooks/
│   ├── hooks.json           (optional; inline in plugin.json also allowed)
│   └── optional-extra.json
├── .mcp.json               (MCP server config)
├── .lsp.json               (LSP server config)
├── monitors/
│   └── monitors.json
├── bin/                    (Executables added to Bash PATH)
├── settings.json           (Default plugin settings)
├── output-styles/
└── themes/                 (Experimental)
```

**Critical constraint**: `.claude-plugin/` contains **only** plugin.json. All other directories (skills/, commands/, agents/, hooks/, etc.) must be at the **plugin root level**, not inside `.claude-plugin/`.

出典: [Plugins / Plugin structure overview](https://code.claude.com/docs/en/plugins.md#plugin-structure-overview) — Warning box

---

### 1.2 plugin.json Manifest Schema

出典: [Plugins reference / Plugin manifest schema](https://code.claude.com/docs/en/plugins-reference.md#plugin-manifest-schema)

#### Required Fields
- **name** (string): kebab-case identifier (no spaces). Used for component namespacing.

#### Metadata Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| displayName | string | No | Human-readable name (v2.1.143+). Falls back to name. |
| version | string | No | Semantic version. If omitted, git commit SHA is used. |
| description | string | No | Brief plugin purpose. |
| author.name | string | No | Author attribution. |
| author.email | string | No | Email. |
| author.url | string | No | URL. |
| homepage | string | No | Documentation URL. |
| repository | string | No | Source code URL. |
| license | string | No | License identifier (e.g., MIT). |
| keywords | array | No | Discovery tags. |
| defaultEnabled | boolean | No | Start disabled on install (v2.1.154+). Defaults to true. |

#### Component Path Fields
| Field | Type | Behavior | Description |
|-------|------|----------|-------------|
| skills | string / array | Extends default skills/ | Custom skill directories. |
| commands | string / array | Replaces commands/ | Legacy: flat .md files. |
| agents | string / array | Replaces agents/ | Subagent markdown files. |
| hooks | string / array / object | Merged across all sources | Hook config paths or inline. |
| mcpServers | string / array / object | Merged across all sources | MCP server configs. |
| outputStyles | string / array | Replaces default | Output style definitions. |
| lspServers | string / array / object | Merged across all sources | LSP server configs. |
| experimental.themes | string / array | Replaces default | Color theme definitions. |
| experimental.monitors | string / array | Replaces default | Background monitor configs. |
| dependencies | array | — | Plugin dependency declarations. |
| userConfig | object | — | User-configurable values. |
| channels | array | — | Message channel declarations. |

出典: [Plugins reference / Metadata fields](https://code.claude.com/docs/en/plugins-reference.md#metadata-fields)

**Complete schema example**:

```json
{
  "name": "cmux-msg",
  "displayName": "cmux-msg Plugin",
  "version": "1.0.0",
  "description": "Messaging plugin",
  "author": { "name": "Your Name" },
  "homepage": "https://github.com/...",
  "license": "MIT",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

---

### 1.3 環境変数 (Plugin Context)

出典: [Plugins reference / Environment variables](https://code.claude.com/docs/en/plugins-reference.md#environment-variables)

| Variable | Resolves to | Example | Notes |
|----------|-------------|---------|-------|
| ${CLAUDE_PLUGIN_ROOT} | Plugin installation directory | /Users/.../plugins/cache/cmux-msg-v1.2/ | Ephemeral per version. Quote in shells. |
| ${CLAUDE_PLUGIN_DATA} | Persistent plugin state dir | ~/.claude/plugins/data/cmux-msg/ | Survives plugin updates. Auto-created. |
| ${CLAUDE_PROJECT_DIR} | Project root (cwd at startup) | /path/to/repo | Same as hooks' CLAUDE_PROJECT_DIR. |

**Important**: When a plugin updates **mid-session**, hooks/MCP/LSP keep using the previous version's path until /reload-plugins or session restart. Treat CLAUDE_PLUGIN_ROOT as ephemeral; write persistent data to CLAUDE_PLUGIN_DATA.

---

## 2. Skill (SKILL.md) 仕様

出典: [Skills](https://code.claude.com/docs/en/skills.md)

### 2.1 Frontmatter Fields

```yaml
---
name: my-skill
description: What this skill does and when to use it
disable-model-invocation: false
user-invocable: true
argument-hint: "[issue-number]"
arguments: [issue, branch]
allowed-tools: Read Grep Bash
disallowed-tools: Edit Write
model: sonnet
effort: high
context: fork
agent: Explore
hooks: {}
paths: "src/**/*.py,tests/**/*.py"
shell: bash
when_to_use: "Additional trigger phrases"
---

Your skill instructions here...
```

出典: [Skills / Frontmatter reference](https://code.claude.com/docs/en/skills.md#frontmatter-reference)

#### Field Descriptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| name | string | (directory name) | Display name. For plugin root SKILL.md, sets invocation name. |
| description | string | (first paragraph) | When Claude should invoke. Combined with when_to_use, truncated at 1,536 chars. |
| when_to_use | string | (none) | Additional context appended to description. |
| disable-model-invocation | boolean | false | If true, Claude cannot invoke; only users can. |
| user-invocable | boolean | true | If false, hidden from menu; only Claude can invoke. |
| argument-hint | string | (none) | Hint shown in autocomplete. |
| arguments | string / array | (none) | Named positional arguments for dollar-name substitution. |
| allowed-tools | string / array | (none) | Tools callable without permission when skill active. |
| disallowed-tools | string / array | (none) | Tools removed from availability during skill. |
| model | string | (session model) | Model to use when skill active. |
| effort | string | (session effort) | Effort level: low, medium, high, xhigh, max. |
| context | string | (inline) | Set to fork to run in isolated subagent context. |
| agent | string | (general-purpose) | Subagent type for context: fork. |
| hooks | object | (none) | Hooks scoped to skill lifecycle. |
| paths | string / array | (none) | Glob patterns limiting when skill auto-activates. |
| shell | string | bash | Shell for command blocks: bash or powershell. |

### 2.2 String Substitutions

出典: [Skills / Available string substitutions](https://code.claude.com/docs/en/skills.md#available-string-substitutions)

| Placeholder | Expands to | Example |
|-------------|-----------|---------|
| ARGUMENTS | All user arguments as string | /my-skill foo bar → foo bar |
| ARGUMENTS[N] | N-th argument (0-based) | ARGUMENTS[0] → first arg |
| N | Shorthand for ARGUMENTS[N] | 0 → first arg, 1 → second |
| $name | Named argument from arguments frontmatter | With arguments: [issue, branch], issue → first |
| CLAUDE_SESSION_ID | Current session UUID | For logging, session correlation. |
| CLAUDE_EFFORT | Current effort level | low, medium, high, xhigh, max, ultra |
| CLAUDE_SKILL_DIR | Skill directory path | Plugin skills resolve to skill subdir. |

**Argument parsing**: Shell-style quoting. /my-skill "hello world" second makes first arg = hello world, second arg = second.

### 2.3 Dynamic Context Injection

出典: [Skills / Inject dynamic context](https://code.claude.com/docs/en/skills.md#inject-dynamic-context)

Syntax: backtick-command on its own line or after whitespace. Executes **before** Claude sees the skill; output replaces the placeholder.

**Important**: This is **preprocessing, not something Claude executes**. Output is inserted as plain text, not re-scanned. Disable with "disableSkillShellExecution": true in settings.

### 2.4 Invocation Name Resolution

出典: [Skills / How a skill gets its command name](https://code.claude.com/docs/en/skills.md#how-a-skill-gets-its-command-name)

| Location | Command Name Source | Example |
|----------|-------------------|---------|
| ~/.claude/skills/name/SKILL.md | Directory name | deploy-staging/ → /deploy-staging |
| .claude/skills/name/SKILL.md | Directory name | deploy-staging/ → /deploy-staging |
| .claude/commands/name.md | File name (no ext) | deploy.md → /deploy |
| plugin/skills/name/SKILL.md | Directory name + plugin ns | review/ in cmux-msg/ → /cmux-msg:review |
| plugin/SKILL.md (root) | Frontmatter name, fallback plugin dir | With name: review → /cmux-msg:review |

The **frontmatter name field only sets the command name** for plugin-root SKILL.md; elsewhere it is display-only.

### 2.5 Content Lifecycle

When invoked, the rendered SKILL.md enters the conversation as a **single message** and stays for the rest of the session. Claude Code does **not re-read** the file on later turns.

---

## 3. Hooks (hooks.json / settings hooks) 仕様

出典: [Hooks guide](https://code.claude.com/docs/en/hooks-guide.md)

### 3.1 Hook Events (Lifecycle)

| Event | When it fires | Blockable |
|-------|---------------|-----------|
| SessionStart | Session begins/resumes | No (exit 2 shows stderr) |
| UserPromptSubmit | User submits prompt (30s timeout) | Yes |
| PreToolUse | Before tool executes | Yes |
| PostToolUse | After tool succeeds | No |
| Stop | Claude finishes responding | Yes (with block cap) |
| SessionEnd | Session terminates | No |
| ConfigChange | Config file changes during session | Yes (exit 2 blocks effect) |
| CwdChanged | Working directory changes | No |
| FileChanged | Watched file changes | No |
| (and many others...) | See reference | See reference |

### 3.2 Hook Configuration Structure

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "if": "Bash(git *)",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PROJECT_DIR}\"/.claude/hooks/check-policy.sh",
            "args": [],
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| matcher | string | (matches all) | Filter by tool name, event reason, or filename. |
| if | string | (no filter) | Permission rule syntax filtering (e.g., Bash(git *)). |
| type | string | — | command, http, mcp_tool, prompt, agent |
| timeout | number | (type-dependent) | Seconds. command/http/mcp_tool: 600s. prompt: 30s. agent: 60s. |

### 3.3 Hook Input / Output Format

出典: [Hooks guide / Read input and return output](https://code.claude.com/docs/en/hooks-guide.md#read-input-and-return-output)

#### Hook Input (stdin JSON)

All hooks receive **common fields**:

```json
{
  "session_id": "abc-123-def",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "permission_mode": "default"
}
```

Event-specific fields appended (e.g., PreToolUse adds tool_name, tool_input):

```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" }
}
```

#### Hook Output & Exit Codes

| Exit Code | Behavior |
|-----------|----------|
| 0 | Success. Parse JSON output if present. Otherwise, no decision. |
| 2 | Blocking error. Show stderr to user. |
| Other | Non-blocking error. Continue, show hook error notice. |

### 3.4 Hook Configuration Location

| Location | Scope | Shareable |
|----------|-------|-----------|
| ~/.claude/settings.json | All projects | No (local) |
| .claude/settings.json | Single project | Yes (checked in) |
| .claude/settings.local.json | Single project | No (gitignored) |
| plugin/hooks/hooks.json | When plugin enabled | Yes (in plugin) |

---

## 4. Plugin Manifest での変数展開

出典: [Plugins reference / Environment variables](https://code.claude.com/docs/en/plugins-reference.md#environment-variables)

In hook commands, MCP/LSP configs, monitor commands, and **skill content**:

CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA, CLAUDE_PROJECT_DIR are **expanded inline** before passing to shell. Quote in shell-form commands to handle paths with spaces.

For skill content, also applies **skill-specific placeholders**:
- CLAUDE_SKILL_DIR: For plugin skills, resolves to the skill's subdirectory within the plugin.

---

## 5. 重要な制約事項

### 5.1 Path Resolution Rules

- All paths are **relative to plugin root** and start with `./`.
- When a field **Replaces** the default directory, if both manifest key and default directory exist, Claude Code v2.1.140+ flags ignored folder as warning.
- When a field **Extends**, both default and custom paths are scanned.
- When a field is **Merged**, hooks/MCP/LSP from all sources combine.

### 5.2 Hooks 強制力

出典: [Hooks guide / Hooks and permission modes](https://code.claude.com/docs/en/hooks-guide.md#hooks-and-permission-modes)

- PreToolUse hook that returns deny → **bypassPermissions mode 下でも block される**.
- Deny rules in settings → Hook's allow decision を override.

→ Hooks are **rule enforcer**, permission rules are **hard constraint**.

### 5.3 Plugin Update時のPath有効期限

When a plugin **updates mid-session**:
- CLAUDE_PLUGIN_ROOT = **古いバージョンのパスのまま** (until /reload-plugins)
- CLAUDE_PLUGIN_DATA = **新バージョンでも同じパスで有効**
- 前バージョンディレクトリは7日後に自動削除

→ Persistent state は常に CLAUDE_PLUGIN_DATA に書く。

---

## 参考リンク

- [Claude Code Plugins](https://code.claude.com/docs/en/plugins.md)
- [Plugins Reference](https://code.claude.com/docs/en/plugins-reference.md)
- [Skills](https://code.claude.com/docs/en/skills.md)
- [Automate workflows with hooks](https://code.claude.com/docs/en/hooks-guide.md)
- [Hooks Reference](https://code.claude.com/docs/llms.txt)

---

**Document Version**: 2026-05-29  
**Claude Code Version References**: v2.1.142+, v2.1.143+, v2.1.154+  
**Status**: Spec-extracted; empirical verification recommended for edge cases.
