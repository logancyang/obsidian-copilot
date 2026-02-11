# Obsidian CLI Integration Design (MVP)

**Date:** 2026-02-11  
**Status:** Draft  
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

## 4. Current Architecture Fit

Relevant integration points:

- `src/tools/ToolRegistry.ts` for tool registration and metadata.
- `src/tools/builtinTools.ts` for built-in tool definitions and initialization.
- `src/LLMProviders/chainRunner/utils/toolExecution.ts` for execution control and user-facing tool status behavior.
- `src/settings/model.ts` and `src/constants.ts` for defaults and persisted settings.
- `src/settings/v2/components/ToolSettingsSection.tsx` for user tool toggles.

This means we can ship CLI support as one additional built-in tool (or a small tool set) without changing chat/message architecture.

## 5. Options Considered

### Option A: One tool per CLI command

- Pros: typed schemas per command, better model guidance.
- Cons: high implementation and maintenance cost (large command surface).

### Option B: One generic CLI gateway tool (recommended for MVP)

- Pros: fastest path, minimal code churn, easy rollout with strict allowlist.
- Cons: weaker per-command typing initially; stronger runtime validation needed.

Recommendation: ship Option B first, then add typed wrappers for high-value commands.

## 6. Proposed MVP Design

### 6.1 Service Layer: `ObsidianCliClient`

Add a service module (example path: `src/services/obsidianCli/ObsidianCliClient.ts`) responsible for:

1. CLI availability/version checks.
2. Safe command execution via `execFile` (not shell).
3. Argument serialization to `parameter=value` and boolean flags.
4. Timeout + output-size limits.
5. Structured error mapping for tool responses.

Key guardrails:

- No shell interpolation.
- Strict command allowlist.
- Desktop-only runtime guard.
- Redact sensitive values in logs.

### 6.2 Tool Layer: `obsidianCli`

Add one built-in tool (example path: `src/tools/ObsidianCliTool.ts`) with:

- `command`: allowed command id.
- `params`: key/value object to serialize into CLI arguments.

The tool returns structured JSON including:

- `command`
- `stdout`
- `stderr`
- `exitCode`
- `durationMs`

Register in `src/tools/builtinTools.ts` with metadata:

- `id: "obsidianCli"`
- category: `custom` (or `file`, based on UI preference)
- not always enabled by default
- desktop-only behavior in execution path

### 6.3 Settings

Add settings fields:

1. `enableObsidianCliBridge: boolean` (default `false`).
2. `obsidianCliPath: string` (default `"obsidian"`).
3. `obsidianCliTimeoutMs: number` (default `15000`).
4. `obsidianCliAllowMutations: boolean` (default `false`).

This keeps rollout explicit and reversible.

### 6.4 Versioned Capability Tiers

This roadmap reflects the selected initial scope.

#### v0 (Initial release)

Capability groups:

- Daily notes
- Random notes

Representative commands:

- `daily`, `daily:read`, `daily:append`, `daily:prepend`
- `random`, `random:read`

Notes:

- Start read-first (`daily:read`, `random:read`) and gate writing commands (`daily:append`, `daily:prepend`) behind mutation settings.

#### v1

Capability groups:

- Properties
- Tags
- Tasks
- Files/folders

Representative commands:

- Properties: `aliases`, `properties`, `property:read`, `property:set`, `property:remove`
- Tags/tasks: `tags`, `tag`, `tasks`, `task`
- Files/folders: `file`, `files`, `folder`, `folders`, `open`, `create`, `read`, `append`, `prepend`, `move`, `delete`

Notes:

- Keep mutation commands gated (`create`, `append`, `prepend`, `move`, `delete`, `property:set`, `property:remove`).
- Prefer deterministic runtime command resolution for file operations to reduce model routing errors.

#### v2

Capability groups:

- History/recovery
- Links graph and structure
- Bases
- Publish
- Templates

Representative commands:

- History/recovery: `diff`, `history`, `history:list`, `history:read`, `history:restore`, `history:open`
- Links graph and structure: `backlinks`, `links`, `unresolved`, `orphans`, `deadends`, `outline`
- Bases: `bases`, `base:views`, `base:create`, `base:query`
- Publish: `publish:site`, `publish:list`, `publish:status`, `publish:add`, `publish:remove`, `publish:open`
- Templates: `templates`, `template:read`, `template:insert`

Notes:

- Bases is expected to become a major investment area with deeper typed abstractions beyond the generic gateway.
- Start v2 with read/query paths, then expand to create/update commands with explicit policy and confirmation controls.

Mutating commands should remain disabled unless `obsidianCliAllowMutations` is enabled.

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

### Phase 0: Design + scaffolding

- Add doc, service skeleton, tool skeleton, settings placeholders.

### Phase 1: v0 capability launch (Daily + Random)

- Enable v0 allowlist and routing policies.
- Gate behind setting and desktop checks.
- Keep write commands in v0 gated by mutation controls.

### Phase 2: v1 expansion (Properties + Tags + Tasks + Files/Folders)

- Add v1 allowlist and stronger runtime validation for file/property writes.
- Reuse existing confirmation pathways for mutating operations.

### Phase 3: v2 expansion (History/Links/Bases/Publish/Templates)

- Add v2 allowlist in sub-stages, beginning with read/query-heavy commands.
- Introduce typed wrappers for high-value command families as routing complexity grows.
- Prioritize a dedicated Bases track due to expected scope and long-term product impact.

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
