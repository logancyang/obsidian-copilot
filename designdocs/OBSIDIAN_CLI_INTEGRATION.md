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

| Tool                 | Commands      | Notes                                        |
| -------------------- | ------------- | -------------------------------------------- |
| `obsidianDailyRead`  | `daily:read`  | Read-only. Dedicated tool for v0 simplicity. |
| `obsidianRandomRead` | `random:read` | Read-only. Dedicated tool for v0 simplicity. |

### v1 (Current — 13 commands across 7 tools)

All v1 tools are **read-only or direct-execution** (no confirmation UX required).

| Tool                   | Commands                                                    | Notes                                                                                           |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **obsidianDailyNote**  | `daily:read`, `daily:append`, `daily:prepend`, `daily:path` | Append/prepend execute directly (see Write Operations Policy). Subsumes v0 `obsidianDailyRead`. |
| **obsidianProperties** | `properties`, `property:read`                               | Read-only. Write commands (`property:set`, `property:remove`) deferred to v2.                   |
| **obsidianTasks**      | `tasks`                                                     | Read-only (task listing). Write command (`task` toggle/status) deferred to v2.                  |
| **obsidianRandomRead** | `random:read`                                               | Read-only. Standalone tool (single command). Continues from v0.                                 |
| **obsidianLinks**      | `backlinks`, `links`, `orphans`, `unresolved`               | All read-only                                                                                   |
| **obsidianTemplates**  | `templates`, `template:read`                                | Read-only. `template:insert` deferred (requires active file context). Moved from v2.            |
| **obsidianBases**      | `bases`, `base:views`, `base:query`, `base:create`          | Read + create. `base:create` executes directly (see Write Operations Policy).                   |

### v2 (Future — ~9 commands: 3 mutations on existing tools + 2 new tools)

v2 introduces **confirmation-required mutations** on existing v1 tools and adds new tool categories.

| Tool                                    | Commands                          | Notes                                                                   |
| --------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| **obsidianProperties** _(v1 extension)_ | `property:set`, `property:remove` | Light confirmation in chat before executing. Extends v1 read-only tool. |
| **obsidianTasks** _(v1 extension)_      | `task` (toggle/done/todo/status)  | Light confirmation in chat before executing. Extends v1 read-only tool. |
| **obsidianBookmarks**                   | `bookmarks`, `bookmark`           | `bookmark` (add) gated by mutation setting                              |

### Excluded from Tool System

The following CLI commands are **not exposed** to the AI agent:

| Category                | Commands                                                        | Rationale                                                                                                          |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Destructive file ops    | `delete`, `move`, `rename`, `create --overwrite`                | Too dangerous for autonomous agent use                                                                             |
| Plugin/theme management | `plugin:*`, `theme:*`, `snippet:*`                              | Not an AI task, security risk                                                                                      |
| Sync & history          | `sync:*`, `history:restore`, `diff`                             | User-managed operations, data loss risk                                                                            |
| UI/workspace control    | `tabs`, `tab:open`, `workspace`, `open`, `daily` (open variant) | UI-only, no data value for LLM                                                                                     |
| System commands         | `reload`, `restart`, `version`, `vault`, `vaults`               | Not useful for agent workflows                                                                                     |
| Developer tools         | `eval`, `dev:*`, `devtools`                                     | Arbitrary code execution risk                                                                                      |
| Niche metadata          | `aliases`, `wordcount`, `recents`, `hotkeys`, `commands`        | Low AI synergy                                                                                                     |
| Search                  | `search`, `search:context`, `search:open`                       | Redundant with Copilot's existing keyword + semantic search (`localSearch`)                                        |
| File read               | `read`                                                          | Redundant with Copilot's existing `readNote` tool (see Tool Disambiguation)                                        |
| Tag listing             | `tags`                                                          | Redundant with Copilot's existing `getTagList` tool (see Tool Disambiguation)                                      |
| Arbitrary file writes   | `append`, `prepend`, `create`                                   | File modifications beyond daily notes should go through the existing Composer tool (`writeToFile`/`replaceInFile`) |

### Write Operations Policy

| Operation                         | Execution model                                | Tier | Rationale                                                                                             |
| --------------------------------- | ---------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| **Daily note append/prepend**     | Direct execution, show result in chat response | v1   | User explicitly asked for the action; daily notes are append-only by nature and low-risk              |
| **Base create**                   | Direct execution, show result in chat response | v1   | User explicitly asked to add an item; creates a new note matching Base filters, additive and low-risk |
| **Arbitrary file append/prepend** | Excluded — use Composer tool                   | —    | File modifications beyond daily notes need the Composer diff/preview UX for safety                    |
| **Property set/remove**           | Light confirmation in chat before executing    | v2   | Metadata changes are reversible but should be intentional; deferred to validate read-only tools first |
| **Task toggle/status**            | Light confirmation in chat before executing    | v2   | Status changes are reversible but should be intentional; deferred to validate read-only tools first   |

### Tool Disambiguation

CLI tools are **complementary** to existing internal tools, not replacements. Several CLI commands were evaluated and intentionally excluded because Copilot already has superior internal implementations:

| CLI Command                   | Existing Internal Tool          | Why Internal Wins                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`                        | `readNote`                      | In-process (`app.vault.cachedRead`), 200-line chunking, multi-strategy path resolution (wikilink, basename, partial match), linked notes extraction, mtime metadata. CLI `read` spawns a process, returns raw text, and requires exact paths. |
| `tags`                        | `getTagList`                    | In-process (`app.metadataCache`), structured JSON with occurrence counts, frontmatter/inline breakdown, progressive size limiting (500KB cap), configurable `maxEntries`. CLI `tags` returns unstructured text with no filtering.             |
| `search`, `search:context`    | `localSearch`                   | Hybrid keyword + semantic search with BM25, query expansion, reranking, time range filtering, tag-aware retrieval. CLI search is basic text matching.                                                                                         |
| `append`, `prepend`, `create` | `writeToFile` / `replaceInFile` | Composer diff/preview UX for safety, line-ending normalization, SEARCH/REPLACE blocks, auto-accept setting. Exception: `daily:append`/`daily:prepend` use CLI directly (low-risk, append-only).                                               |

**Prompt instruction guidelines for CLI tools:**

- Each CLI tool's `customPromptInstructions` must include explicit disambiguation guidance directing the LLM to the correct tool.
- Example: "Use `readNote` for reading specific notes by path. Use `obsidianDailyNote` for daily note operations (read, append, prepend). Use `obsidianRandomRead` for picking a random note."
- When an existing internal tool and a CLI tool could both handle a request, the internal tool should be preferred unless the CLI tool provides unique capability (e.g., daily note path resolution, random note selection, backlink traversal).

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

- Refactor v0 `obsidianDailyRead` into category-based `obsidianDailyNote` (read, append, prepend, path).
- Keep `obsidianRandomRead` as standalone tool (single command).
- Add `obsidianProperties` (read-only), `obsidianTasks` (read-only), `obsidianLinks` tools.
- All v1 tools are read-only or direct-execution — no confirmation UX needed.
- Add per-tool command allowlists and prompt disambiguation guidance.

### Phase 3: v2 expansion

- Add confirmation-required mutations to existing v1 tools: `property:set`, `property:remove`, `task` toggle/status.
- Implement mutation gating via `obsidianCliAllowMutations` setting and light confirmation UX.
- Add new tool categories: `obsidianTemplates`, `obsidianBases`, `obsidianBookmarks`.

## 10. Risks and Mitigations

1. CLI behavior/version drift.
   Mitigation: version checks + graceful fallback.
2. Security risks from command injection.
   Mitigation: `execFile`, allowlist, strict param serializer.
3. UX confusion between existing tools and CLI-backed actions.
   Mitigation: clear tool naming + incremental command scope.

## 11. Open Questions

### Resolved

1. ~~Should `obsidianCli` be exposed in standard tool settings for all users, or hidden behind a feature flag first?~~
   **Resolved**: CLI tools are registered in `ToolRegistry` like any other tool, gated by `Platform.isDesktopApp`. No separate feature flag — they appear in tool settings on desktop, invisible on mobile.

2. ~~Do we want a dedicated category for CLI-backed tools?~~
   **Resolved**: No dedicated category. CLI tools use category `"file"` alongside existing file tools. They are distinguished by their `id` prefix (`obsidian*`) and `displayName` suffix `(CLI)`.

3. ~~Should we prefer existing internal tools over CLI for certain operations (for consistency/performance)?~~
   **Resolved**: Yes. Internal tools are preferred when they exist. See Tool Disambiguation section — `readNote` over CLI `read`, `getTagList` over CLI `tags`, `localSearch` over CLI `search`, Composer over CLI file writes. CLI tools are only used for capabilities without an internal equivalent.

### Open

1. What minimum CLI version should be required for initial support?
2. How should the agent reliably choose between similar tools when both could handle a request? For example, `daily:append`/`daily:prepend` vs the Composer tool (`writeToFile`/`replaceInFile`) when the user says "add something to my daily note." Current approach is prompt-instruction disambiguation, but this depends on LLM adherence to instructions. Alternatives: remove overlapping commands entirely, or add runtime routing that intercepts and redirects.
3. Can we reliably resolve the Obsidian CLI binary path across platforms? Current approach: try `obsidian` on PATH → env vars (`OBSIDIAN_CLI_BINARY`, `OBSIDIAN_CLI_PATH`) → macOS fallback paths (`/Applications/Obsidian.app/Contents/MacOS/obsidian`). Windows and Linux fallback paths are not yet implemented. If the CLI is not on PATH and no env var is set, the tool fails. Should we add a settings field for manual path override, or auto-detect from known install locations per platform?

---

## Appendix A: V1 CLI Command Reference

All commands are invoked as `obsidian <command> [params...]`. Output is **plain text** (no `format=json`) — LLMs consume text natively without the token overhead of JSON structure.

Global parameter available on all commands: `vault=<name>` (targets a specific vault; omit for default).

### A.1 `obsidianDailyNote` — Daily Note Operations

#### `daily:read`

Read today's daily note content.

```
obsidian daily:read
```

| Parameter | Required | Description                                    |
| --------- | -------- | ---------------------------------------------- |
| _(none)_  |          | No parameters. Reads the daily note for today. |

**Output**: Full markdown content of today's daily note. Empty string if no daily note exists.

```
# 2026-03-03

## Tasks
- [ ] Review PR #2181
- [x] Update design doc

## Notes
Meeting with Alice about CLI integration...
```

#### `daily:path`

Get the vault-relative file path of today's daily note.

```
obsidian daily:path
```

| Parameter | Required | Description    |
| --------- | -------- | -------------- |
| _(none)_  |          | No parameters. |

**Output**: Single line — the vault-relative path.

```
2026-03-03.md
```

This is the only way to discover the daily note path without knowing the user's daily note folder/date format configuration.

#### `daily:append`

Append content to the end of today's daily note. Creates the daily note if it doesn't exist.

```
obsidian daily:append content="- Meeting with Alice at 3pm"
```

| Parameter        | Required | Description                                     |
| ---------------- | -------- | ----------------------------------------------- |
| `content=<text>` | Yes      | Text to append.                                 |
| `inline`         | No       | Boolean flag. Append without a leading newline. |

**Output**: Empty on success. The content is added at the end of the file.

**Note**: `open` and `paneType` parameters are accepted by the CLI but are not passed by the tool (UI-only, no value for agent).

#### `daily:prepend`

Prepend content to the beginning of today's daily note (after frontmatter). Creates the daily note if it doesn't exist.

```
obsidian daily:prepend content="## Morning Standup"
```

| Parameter        | Required | Description                                       |
| ---------------- | -------- | ------------------------------------------------- |
| `content=<text>` | Yes      | Text to prepend.                                  |
| `inline`         | No       | Boolean flag. Prepend without a trailing newline. |

**Output**: Empty on success.

---

### A.2 `obsidianProperties` — Note Property Access

#### `properties`

List frontmatter properties. Can operate vault-wide or on a specific note.

**Vault-wide** (list all property names used across the vault):

```
obsidian properties
```

```
aliases
author
cssclasses
date
tags
title
```

**For a specific note** (list that note's property key-value pairs):

```
obsidian properties file="Rewrite as tweet"
```

```
copilot-command-context-menu-enabled: false
copilot-command-slash-enabled: false
copilot-command-context-menu-order: 90
copilot-command-model-key: ""
copilot-command-last-used: 0
```

| Parameter     | Required | Description                                               |
| ------------- | -------- | --------------------------------------------------------- |
| `file=<name>` | No       | Target file by name (without extension).                  |
| `path=<path>` | No       | Target file by vault-relative path.                       |
| `name=<name>` | No       | Get count for a specific property name (vault-wide mode). |
| `counts`      | No       | Include occurrence counts (vault-wide mode).              |
| `sort=count`  | No       | Sort by count instead of name (vault-wide mode).          |
| `total`       | No       | Return only the property count.                           |

**Output (vault-wide)**: One property name per line, alphabetically sorted by default. With `counts`, format is `name: count`. With `total`, a single number.

**Output (per-file)**: `key: value` pairs, one per line (YAML-like).

#### `property:read`

Read a single property value from a specific note.

```
obsidian property:read name="tags" file="My Note"
```

| Parameter     | Required | Description                         |
| ------------- | -------- | ----------------------------------- |
| `name=<name>` | Yes      | Property name to read.              |
| `file=<name>` | No       | Target file by name.                |
| `path=<path>` | No       | Target file by vault-relative path. |

**Output**: The raw property value. For arrays, comma-separated. For strings, the plain value.

```
90
```

---

### A.3 `obsidianTasks` — Task Listing

#### `tasks`

List tasks across the vault with filtering options.

```
obsidian tasks todo
obsidian tasks file="Project Plan" verbose
obsidian tasks daily
```

| Parameter         | Required | Description                                                      |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `file=<name>`     | No       | Filter by file name.                                             |
| `path=<path>`     | No       | Filter by file path.                                             |
| `todo`            | No       | Show only incomplete tasks.                                      |
| `done`            | No       | Show only completed tasks.                                       |
| `status="<char>"` | No       | Filter by status character (e.g., `status="/"` for in-progress). |
| `daily`           | No       | Show tasks from today's daily note.                              |
| `verbose`         | No       | Group tasks by file with line numbers.                           |
| `total`           | No       | Return only the task count.                                      |

**Output (default text)**: One task per line, markdown checkbox format.

```
- [ ] Review PR #2181
- [ ] Update design doc
- [x] Write CLI client tests
```

**Output (verbose)**: Tasks grouped under file headings with line numbers.

```
Projects/launch-plan.md
  L12: - [ ] Review PR #2181
  L15: - [x] Write CLI client tests

Daily/2026-03-03.md
  L8: - [ ] Update design doc
```

**Output (total)**: Single number.

```
3
```

**Empty result**: `No tasks found.`

---

### A.4 `obsidianRandomRead` — Random Note

#### `random:read`

Read a randomly selected markdown note from the vault.

```
obsidian random:read
obsidian random:read folder="Ideas"
```

| Parameter       | Required | Description                           |
| --------------- | -------- | ------------------------------------- |
| `folder=<path>` | No       | Limit selection to a specific folder. |

**Output**: Full markdown content of the randomly selected note. A different note is returned each invocation.

**Empty result**: `No markdown files found.` (when folder is empty or doesn't exist).

---

### A.5 `obsidianLinks` — Link Graph Queries

#### `backlinks`

List notes that link TO a given file (incoming links).

```
obsidian backlinks file="My Note"
obsidian backlinks path="Projects/plan.md" counts
```

| Parameter     | Required | Description                          |
| ------------- | -------- | ------------------------------------ |
| `file=<name>` | No       | Target file by name.                 |
| `path=<path>` | No       | Target file by vault-relative path.  |
| `counts`      | No       | Include link counts per source file. |
| `total`       | No       | Return only the backlink count.      |

**Output (default TSV)**: One source file per line.

```
Projects/roadmap.md
Daily/2026-03-01.md
```

**Output (counts)**: Source file with link count.

```
Projects/roadmap.md	3
Daily/2026-03-01.md	1
```

**Output (total)**: Single number.

**Empty result**: `No backlinks found.`

#### `links`

List outgoing links FROM a given file.

```
obsidian links file="My Note"
obsidian links path="Projects/plan.md" total
```

| Parameter     | Required | Description                         |
| ------------- | -------- | ----------------------------------- |
| `file=<name>` | No       | Source file by name.                |
| `path=<path>` | No       | Source file by vault-relative path. |
| `total`       | No       | Return only the link count.         |

**Output**: One link target per line.

```
Projects/roadmap.md
Ideas/brainstorm.md
```

**Empty result**: `No links found.`

#### `orphans`

List files with no incoming links (not linked from any other note).

```
obsidian orphans
obsidian orphans total
```

| Parameter | Required | Description                                      |
| --------- | -------- | ------------------------------------------------ |
| `total`   | No       | Return only the orphan count.                    |
| `all`     | No       | Include non-markdown files (images, PDFs, etc.). |

**Output**: One file path per line.

```
2026-03-03.md
BOT/DailyAIDigest/2026-02-26-Daily-AI-Digest.md
copilot/copilot-conversations/hello@20260302_145233.md
DemoCanvas.canvas
```

**Output (total)**: Single number (e.g., `84`).

#### `unresolved`

List wikilinks that don't resolve to any existing file in the vault.

```
obsidian unresolved
obsidian unresolved counts verbose
obsidian unresolved total
```

| Parameter | Required | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `counts`  | No       | Include how many times each unresolved link appears. |
| `verbose` | No       | Include source file for each unresolved link.        |
| `total`   | No       | Return only the unresolved link count.               |

**Output (default TSV)**: One unresolved link target per line.

```
Nonexistent Note
Old Project Reference
meeting-notes-2025
```

**Output (counts)**: Link target with occurrence count.

```
Nonexistent Note	5
Old Project Reference	2
```

**Output (verbose)**: Link target with source files.

```
Nonexistent Note	Projects/roadmap.md
Nonexistent Note	Daily/2026-03-01.md
Old Project Reference	Archive/cleanup.md
```

**Output (total)**: Single number (e.g., `771`).

---

### A.6 `obsidianTemplates` — Template Listing and Reading

#### `templates`

List all available template names in the configured templates folder.

```
obsidian templates
```

| Parameter | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| _(none)_  |          | No parameters. Lists all template names. |

**Output**: One template name per line.

```
Daily Note
Meeting Notes
Project Plan
Weekly Review
```

---

#### `template:read`

Read a template's content with variable placeholders resolved.

```
obsidian template:read name="Daily Note"
```

| Parameter     | Required | Description                                 |
| ------------- | -------- | ------------------------------------------- |
| `name=<name>` | Yes      | Template name (as returned by `templates`). |

**Output**: Full markdown content of the template.

```
# {{date}}

## Tasks
- [ ]

## Notes

```

---

### A.7 `obsidianBases` — Base Database Queries

#### `bases`

List all Base (database) files in the vault.

```
obsidian bases
```

| Parameter | Required | Description                          |
| --------- | -------- | ------------------------------------ |
| `total`   | No       | Return only the count of Base files. |

**Output**: One Base file per line.

```
Contacts.base
Projects.base
Tasks.base
```

**Output (total)**: Single number.

#### `base:views`

List views defined in a Base file.

```
obsidian base:views file="Projects"
obsidian base:views path="Databases/Projects.base"
```

| Parameter     | Required | Description                                   |
| ------------- | -------- | --------------------------------------------- |
| `file=<name>` | No\*     | Target Base file by name (without extension). |
| `path=<path>` | No\*     | Target Base file by vault-relative path.      |

\* One of `file` or `path` is required.

**Output**: One view name per line.

```
All Items
By Status
Kanban
```

#### `base:create`

Create a new item (row) in a Base. The created item is a new markdown note that matches the Base's filter criteria.

```
obsidian base:create file="Library" name="Dune Messiah" content="A book by Frank Herbert"
obsidian base:create path="Databases/Projects.base" view="Active" name="New Feature"
```

| Parameter        | Required | Description                                                   |
| ---------------- | -------- | ------------------------------------------------------------- |
| `file=<name>`    | No\*     | Target Base file by name (without extension).                 |
| `path=<path>`    | No\*     | Target Base file by vault-relative path.                      |
| `view=<name>`    | No       | View to add the item to. Omit for default view.               |
| `name=<name>`    | No       | File name for the created note. Omit for auto-generated name. |
| `content=<text>` | No       | Initial markdown content for the note.                        |

\* One of `file` or `path` is required.

**Output**: Confirmation message with the path of the created note.

**Note**: `open` and `newtab` parameters are accepted by the CLI but not passed by the tool (UI-only, no value for agent).

---

#### `base:query`

Query data from a Base view.

```
obsidian base:query file="Projects" view="All Items"
obsidian base:query path="Databases/Projects.base" format=csv
```

| Parameter      | Required | Description                                         |
| -------------- | -------- | --------------------------------------------------- |
| `file=<name>`  | No\*     | Target Base file by name (without extension).       |
| `path=<path>`  | No\*     | Target Base file by vault-relative path.            |
| `view=<name>`  | No       | View name to query. Omit for default view.          |
| `format=<fmt>` | No       | Output format (e.g., `csv`). Omit for default text. |
| `total`        | No       | Return only the row count.                          |

\* One of `file` or `path` is required.

**Output (default text)**: Tabular data, one row per line.

**Output (csv)**: CSV-formatted data.

```
Name,Status
Alpha,Active
Beta,Done
```

**Output (total)**: Single number.

---

### A.8 Error Responses

All commands return consistent error formats:

| Condition              | Output                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| File not found         | `Error: File "path/to/file.md" not found.`                                                         |
| Missing required param | `Error: Missing required parameter: name=<name>` with usage line                                   |
| No results             | Command-specific empty message (e.g., `No tasks found.`, `No backlinks found.`, `No links found.`) |
| CLI binary not found   | Process error code `ENOENT` — handled by `ObsidianCliClient` fallback resolution                   |
| Timeout                | Process killed after `timeoutMs` — handled by `ObsidianCliClient`                                  |
