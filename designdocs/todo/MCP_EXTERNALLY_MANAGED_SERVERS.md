# MCP servers managed outside the local config

## Problem

When the Claude Code backend is active, the running `claude` binary connects to MCP servers from at least three sources we do not control through `~/.claude.json` or `.mcp.json`:

1. **claude.ai-provisioned remote MCPs** — Gmail, Google Calendar, Google Drive, Slack, etc. Provisioned server-side per claude.ai account; the binary connects to them at startup over HTTPS.
2. **Plugin-provided MCPs** — e.g. `plugin:context7:context7`. Bundled by Claude Code plugins, not declared in any user-editable file.
3. **(Already covered by the main sync plan)** Local config MCPs in `~/.claude.json` and `.mcp.json`.

`claude mcp list` enumerates all three at runtime. `~/.claude.json` only contains category 3. The only local hint of category 1 is a `claudeAiMcpEverConnected: string[]` field, which is informational ("ever connected", not "currently active") and does not include category 2 at all.

### Why this is bad

If the obsidian-copilot MCP panel only shows local-config entries, a user who already has `claude.ai Gmail` connected may add their own `gmail` MCP through the panel. Both register tools under similar/overlapping namespaces; the agent calls become ambiguous, and the user has no signal that the conflict exists.

We've already locked down "extra registration via ACP" by passing `mcpServers: []` when the backend owns runtime registration (see `MCP_BACKEND_SYNC` plan). That stops obsidian-copilot from causing duplicates itself, but it does not prevent the user from creating a duplicate **inside** the local config that collides with a remote claude.ai MCP.

## What we cannot do

- **Disable claude.ai MCPs locally.** No CLI flag, no env var, no config key. Only off-switch is at claude.ai/settings → Connectors (web) or signing the connector out.
- **Disable plugin MCPs without disabling the plugin.** No per-MCP toggle.
- **Get a structured (JSON) list from `claude mcp list`.** Output is human-formatted; parsing is brittle and version-coupled.

Treating these as user-editable is therefore not on the table. The only available shape is **read-only awareness**.

## Options

| Option                               | Effect                                                                                                                                                                                | Cost                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **A. Surface via `claude mcp list`** | Shell out, parse output, render claude.ai/_ and plugin/_ entries as read-only "Managed externally" rows alongside editable local ones. Solves "I don't see it".                       | Brittle parsing; spawns `claude` (~500ms–1s) on panel mount. Output format may change between Claude Code versions. |
| **B. Static informational note**     | Show "Claude Code may connect to remote claude.ai MCPs (Gmail, Calendar, etc.) that aren't editable here. Manage them at claude.ai/settings → Connectors." Just text, no enumeration. | Cheap. Doesn't tell the user _which_ servers, so they can still duplicate by name.                                  |
| **C. Hybrid: warn on name conflict** | Pre-fill known claude.ai MCP names (gmail, calendar, slack, drive — small static list) and warn if user adds a server matching a known remote.                                        | Heuristic; misses unknown remote MCPs and any future additions.                                                     |
| **D. Do nothing**                    | Status quo. User experiences conflict, debugs, learns.                                                                                                                                | Bad UX.                                                                                                             |

### Recommendation

**A + B combined.** Shell out to `claude mcp list` once when the panel mounts, render claude.ai/_ and plugin/_ entries as read-only rows tagged "Managed by claude.ai" / "Managed by plugin", with a static note pointing to claude.ai/settings → Connectors. This is exactly what the user already sees in the terminal, lifted into Obsidian. Cache the result for the lifetime of the panel mount; add a manual "Refresh" button to reread.

Risks to mitigate before implementation:

- Parser must tolerate format changes — fail closed (omit external rows + log warning), never crash the panel.
- The shell-out must be debounced and cancellable; don't block initial render.
- If `claude` is not on PATH at panel mount (binary configured via custom path only), fall back to invoking via the configured `binaryPath` if the same binary supports `mcp list` (it does — same binary).

## Open questions

1. **Render claude.ai/plugin entries inline, or behind a "show external MCPs" disclosure toggle?** Inline is more discoverable; toggle keeps the panel uncluttered for users who never touch external MCPs.
2. **Refresh cadence:** mount-only + manual button, or also re-fetch on `subscribe()` callback from the local-config file watch (since external state can change without local file changes)?
3. **Backend coverage:** does the same problem exist for OpenCode / future Codex backend? If so, the read-only surface should live on `McpStorageAdapter` (`listExternal()` method) rather than be Claude-Code specific.

## Out of scope

- Any attempt to disable, mute, or hide claude.ai MCPs at runtime. The user must do that through claude.ai web settings; we can only point them there.
- Forking or patching `claude-agent-acp`.

## Related

- Main sync plan: see [`AGENT_MODE_TODOS.md`](./AGENT_MODE_TODOS.md) — _P1: Syncing and managing MCP registered in the backends_. This doc covers the externally-managed sub-case that the main sync plan deliberately does not address.
