# Obsidian CLI Integration Design (MVP)

**Date:** 2026-02-11
**Status:** Draft — Experimental, Desktop-Only
**Scope:** Copilot plugin tooling (`AutonomousAgent` + `Copilot Plus` tool execution path)

## 1. Problem Statement

Obsidian now ships an official CLI (early access). Copilot already has a mature tool system, but it currently duplicates vault operations through plugin APIs and internal tool implementations. We need a low-risk path to leverage CLI capabilities without rewriting the agent loop.

## 2. Goals

1. Add Obsidian CLI capabilities with minimal changes to existing architecture.
2. Reuse current `ToolRegistry` + LangChain native tool calling flow.
3. Keep the first release desktop-only, safe-by-default, and observable.
4. Ship capabilities in explicit versioned tiers (`v0` -> `v1` -> `v2`) to keep routing and validation manageable.

## 3. Non-Goals (MVP)

1. No full one-to-one wrapper for every CLI command in the first iteration.
2. No mobile support (CLI is desktop-oriented).
3. No prompt/system-prompt rewrites beyond normal tool metadata guidance.
4. No dependency on interactive TUI mode in agent flows.

## 3a. Platform Policy

These tools are **desktop-only** and **experimental**.

- On mobile platforms, CLI tools are **not registered** in the `ToolRegistry` and are completely invisible to the user — they do not appear in tool settings, tool lists, agent reasoning, or any UI surface.
- Registration is gated by `Platform.isDesktopApp` in `initializeBuiltinTools()`. The runtime guard in `ObsidianCliClient.runObsidianCliCommand()` provides defense-in-depth but is not the primary gating mechanism.
- The Obsidian CLI requires `child_process.execFile`, which is only available in the desktop Electron renderer.

## 3b. Design Rationale — CLI Shell-Out vs Internal API

The CLI shell-out approach was chosen because:

1. **Breadth without cost**: The CLI exposes a large and growing command surface. Reimplementing each command via internal Obsidian APIs (`app.vault`, `app.metadataCache`, etc.) would require significant per-command development and maintenance effort.
2. **Forward compatibility**: New CLI commands become available to the tool system without code changes — only the allowlist needs updating.
3. **Safety**: `execFile` (not shell) with strict argument serialization prevents injection. A command allowlist and mutation gating limit blast radius.
4. **Incremental adoption**: The versioned tier system (v0 → v1 → v2) allows cautious rollout, starting with read-only commands.

Internal API tools remain the right choice for operations that need deep integration (e.g., frontmatter processing via `app.fileManager.processFrontMatter()`). The CLI approach is complementary, not a replacement.

## 4. Current Architecture Fit

Relevant integration points:

- `src/tools/ToolRegistry.ts` for tool registration and metadata.
- `src/tools/builtinTools.ts` for built-in tool definitions and initialization.
- `src/LLMProviders/chainRunner/utils/toolExecution.ts` for execution control and user-facing tool status behavior.
- `src/settings/model.ts` and `src/constants.ts` for defaults and persisted settings.
- `src/settings/v2/components/ToolSettingsSection.tsx` for user tool toggles.

This means we can ship CLI support as one additional built-in tool (or a small tool set) without changing chat/message architecture.

## 5. Tool Organization: Category-Based Grouping

Instead of one tool per CLI command (~100 commands = too many tools) or one generic umbrella tool (too vague for LLM routing), commands are grouped into **category-based tools**. Each tool accepts a `command` parameter scoped to its category.

### Design Rationale

- **Clear semantic signals for the LLM**: User asks about daily notes → `obsidianDailyNote` tool. No ambiguity in tool selection.
- **Scales well**: New CLI commands slot into existing category tools without adding new tool registrations.
- **Manageable tool count**: ~10 tools total vs ~25+ individual tools or 1 opaque gateway.
- **Per-category allowlists**: Each tool validates its `command` parameter against a scoped allowlist, limiting blast radius.

### v0 (Current — 2 commands, 2 tools)

| Tool | Commands | Notes |
|------|----------|-------|
| `obsidianDailyRead` | `daily:read` | Read-only. Dedicated tool for v0 simplicity. |
| `obsidianRandomRead` | `random:read` | Read-only. Dedicated tool for v0 simplicity. |

### v1 (Next — ~16 commands across 5 tools)

| Tool | Commands | Notes |
|------|----------|-------|
| **obsidianDailyNote** | `daily:read`, `daily:append`, `daily:prepend`, `daily:path` | Mutation commands (`append`, `prepend`) gated by `obsidianCliAllowMutations` |
| **obsidianProperties** | `properties`, `property:read`, `property:set`, `property:remove` | `property:set` and `property:remove` gated by mutation setting |
| **obsidianTasks** | `tasks`, `task` (toggle/done/todo/status) | `task` mutations gated |
| **obsidianFiles** | `read`, `append`, `prepend`, `random:read` | `append`/`prepend` gated. Subsumes v0 `obsidianRandomRead`. |
| **obsidianLinks** | `backlinks`, `links`, `orphans`, `unresolved` | All read-only |

### v2 (Future — ~8 commands across 4 tools)

| Tool | Commands | Notes |
|------|----------|-------|
| **obsidianTemplates** | `templates`, `template:read` | Read-only. `template:insert` deferred (requires active file context). |
| **obsidianBases** | `bases`, `base:views`, `base:query` | Read-only. `base:create` deferred to later phase. |
| **obsidianBookmarks** | `bookmarks`, `bookmark` | `bookmark` (add) gated by mutation setting |
| **obsidianTags** | `tags`, `tag` | Read-only |

### Excluded from Tool System

The following CLI commands are **not exposed** to the AI agent:

| Category | Commands | Rationale |
|----------|----------|-----------|
| Destructive file ops | `delete`, `move`, `rename`, `create --overwrite` | Too dangerous for autonomous agent use |
| Plugin/theme management | `plugin:*`, `theme:*`, `snippet:*` | Not an AI task, security risk |
| Sync & history | `sync:*`, `history:restore`, `diff` | User-managed operations, data loss risk |
| UI/workspace control | `tabs`, `tab:open`, `workspace`, `open`, `daily` (open variant) | UI-only, no data value for LLM |
| System commands | `reload`, `restart`, `version`, `vault`, `vaults` | Not useful for agent workflows |
| Developer tools | `eval`, `dev:*`, `devtools` | Arbitrary code execution risk |
| Niche metadata | `aliases`, `wordcount`, `recents`, `hotkeys`, `commands` | Low AI synergy |
| Search | `search`, `search:context`, `search:open` | Redundant with Copilot's existing keyword + semantic search |

## 6. Implementation Design

### 6.1 Service Layer: `ObsidianCliClient`

Located at `src/services/obsidianCli/ObsidianCliClient.ts`. Responsible for:

1. CLI availability/version checks.
2. Safe command execution via `execFile` (not shell).
3. Argument serialization to `parameter=value` and boolean flags.
4. Timeout + output-size limits.
5. Structured error mapping for tool responses.
6. Fallback binary resolution (tries `obsidian` → known macOS app paths).

Key guardrails:

- No shell interpolation.
- Per-tool command allowlist.
- Desktop-only runtime guard.

### 6.2 Tool Layer

Each category tool is a LangChain `StructuredTool` with a zod schema. Tools are registered conditionally in `src/tools/builtinTools.ts` via `registerCliTools()`, gated by `Platform.isDesktopApp`.

### 6.3 Settings

Planned settings fields:

1. `obsidianCliAllowMutations: boolean` (default `false`) — gates write commands across all CLI tools.
2. `obsidianCliTimeoutMs: number` (default `15000`) — per-command timeout.
3. `obsidianCliPath: string` (default `"obsidian"`) — custom binary path override.

## 7. Execution + UX Rules

1. If CLI unavailable, return a clear actionable tool error.
2. If running on mobile, return unsupported-platform error.
3. Surface tool result summaries in existing tool banners/reasoning stream.
4. Keep file-modifying behavior conservative until explicit mutation rollout.

## 8. Testing Plan

Unit tests:

1. Argument serialization (`parameter=value`, booleans, multiline escaping handling).
2. Allowlist enforcement and mutation gating.
3. Timeout/error mapping behavior.
4. Desktop/mobile guards.

Integration tests (mocked process):

1. Successful command execution output.
2. Non-zero exit behavior.
3. Large output truncation/handling.

Manual validation:

1. Run read-only commands from agent mode and verify response quality.
2. Verify settings toggles affect tool availability correctly.

## 9. Rollout Plan

### Phase 0: Design + scaffolding (done)

- Design doc, `ObsidianCliClient` service, `obsidianDailyRead`/`obsidianRandomRead` tools.
- Desktop-only gating via `Platform.isDesktopApp` in `registerCliTools()`.
- Tests for arg serialization, fallback binary resolution, tool wrappers.

### Phase 1: v0 release (current)

- Ship `daily:read` and `random:read` as dedicated read-only tools.
- Validate CLI reliability and UX across desktop platforms.

### Phase 2: v1 expansion

- Refactor v0 tools into category-based tools (`obsidianDailyNote`, `obsidianFiles`, etc.).
- Add `obsidianProperties`, `obsidianTasks`, `obsidianLinks` tools.
- Implement mutation gating via `obsidianCliAllowMutations` setting.
- Add per-tool command allowlists.

### Phase 3: v2 expansion

- Add `obsidianTemplates`, `obsidianBases`, `obsidianBookmarks`, `obsidianTags` tools.
- Start with read/query-only commands, expand to mutations with explicit confirmation controls.

## 10. Risks and Mitigations

1. CLI behavior/version drift.
   Mitigation: version checks + graceful fallback.
2. Security risks from command injection.
   Mitigation: `execFile`, allowlist, strict param serializer.
3. UX confusion between existing tools and CLI-backed actions.
   Mitigation: clear tool naming + incremental command scope.

## 11. Open Questions

1. Should `obsidianCli` be exposed in standard tool settings for all users, or hidden behind a feature flag first?
2. Do we want a dedicated category for CLI-backed tools?
3. Should we prefer existing internal tools over CLI for certain operations (for consistency/performance)?
4. What minimum CLI version should be required for initial support?
