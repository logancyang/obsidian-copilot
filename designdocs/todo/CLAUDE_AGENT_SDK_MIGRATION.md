# ACP → Claude Agent SDK: Capability Comparison & Migration Plan

## Context

The Obsidian Copilot agent mode is built entirely on the Agent Client Protocol (ACP) via `@agentclientprotocol/sdk@0.20.0`. The plugin spawns a vendor-specific subprocess (`claude-code-acp`, `opencode`, or `codex`) and talks to it over stdio JSON-RPC, translating ACP `SessionNotification` events into the chat UI.

ACP is a vendor-neutral protocol layer. That neutrality costs us capability surface for the Anthropic-hosted backend: Anthropic ships features in the Claude Agent SDK that the ACP shim doesn't pass through. The two most user-visible gaps:

- **No `AskUserQuestion`** — Claude can't ask the user clarifying multiple-choice questions mid-turn.
- **`claude-code-acp` adds an extra install hop** — the official SDK still requires the user-installed `claude` CLI (the SDK _publishes_ the binary as a platform-specific optional npm dep, but Obsidian plugins ship as a single bundled `main.js` with no `node_modules/`, so the SDK's auto-discovery can't find it). The win is dropping the `claude-code-acp` shim layer and gaining the SDK's richer capability surface for the Anthropic backend. See §4.5 for the Day-1 spike that resolved the resolver/binary detail.

User decision (confirmed, **scope-corrected**):

- **Replace only the `claude-code-acp` backend with the official Claude Agent SDK.** The `opencode` and `codex` backends stay on ACP indefinitely — they're how non-Anthropic agents reach the chat UI. The multi-backend registry, the `AcpProcessManager`/ACP runtime, the `OpencodeBinaryManager`, and the active-backend selector all remain in place.
- Vault file access on the new SDK backend goes through custom in-process MCP tools that wrap `vault.adapter`, not the SDK's built-in `Read/Write/Edit` against the OS filesystem.

This document is the capability diff and migration assessment to support that direction. Earlier drafts framed this as a wholesale ACP teardown — that framing was wrong; the cleanup sections below have been narrowed to only the Claude-specific paths.

> **Spike completed 2026-05-01.** Open questions in §4 have been resolved — see §4.5. The CLI-resolver search order, Electron renderer patch, and `EnterPlanMode` stream-detection caveat all flow from that work.

---

## 1. Capability comparison

| Capability              | ACP (current)                                                                                                                                                                                       | Claude Agent SDK                                                                                                                                                                                                                                                                                                                               | Migration impact                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution            | External CLI per backend; user installs `claude-code-acp` etc. or we manage an Opencode binary. `AcpProcessManager` + `OpencodeBinaryManager`                                                       | `@anthropic-ai/claude-agent-sdk` from npm. Ships per-platform optional deps with the native `claude` binary, **but** auto-discovery requires `node_modules/` at runtime — Obsidian plugins ship a bundled `main.js` only, so we must always pass `pathToClaudeCodeExecutable` and rely on a user-installed `claude` CLI (or our own resolver). | Smaller win than originally framed: trade 3 installer flows for 1. Delete OpenCode binary manager and ACP backend paths; keep a `claude`-CLI path setting and onboarding check. |
| Transport               | JSON-RPC over stdio frames                                                                                                                                                                          | Async generator from `query()`; SDK spawns the `claude` CLI subprocess (path provided via `pathToClaudeCodeExecutable` — see Distribution row).                                                                                                                                                                                                | Drop `frameSink.ts`, `AcpProcessManager.ts`. Replace with `query()` iterator.                                                                                                   |
| Built-in tools          | Whatever the backend exposes (Read/Edit/Bash/Grep/Glob/WebSearch/WebFetch typically)                                                                                                                | Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, **AskUserQuestion**, Monitor, TodoWrite, Agent                                                                                                                                                                                                                                       | New: **AskUserQuestion** UI, optional Monitor/TodoWrite surfacing.                                                                                                              |
| Custom host tools       | Not supported — host can only forward MCP servers; no in-process tool injection                                                                                                                     | First-class via `createSdkMcpServer({ tools: [tool(...)] })` and `mcpServers: { x: { type: "sdk", instance } }`                                                                                                                                                                                                                                | **Major win.** Replaces ad-hoc vault file ops with proper in-process MCP tools.                                                                                                 |
| Permission flow         | `requestPermission()` RPC with options (`allow_once`, `allow_always`, `reject_once`, `reject_always`); special-cased `ExitPlanMode` switch_mode. `permissionPrompter.ts` + `AcpPermissionModal.tsx` | `canUseTool(toolName, input, ctx) → { behavior: "allow" \| "deny", updatedInput?, updatedPermissions? }` callback + `permissionMode: "default" \| "acceptEdits" \| "plan" \| "bypassPermissions" \| "auto"`                                                                                                                                    | Translation layer needed. Existing modal stays; the resolver/promise plumbing changes shape.                                                                                    |
| Hooks                   | Backend-side only (we can't inject)                                                                                                                                                                 | Host-defined `PreToolUse`, `PostToolUse`, `SessionStart/End`, `UserPromptSubmit`, `Stop`, `PermissionRequest`, `SubagentStart/Stop`, etc.                                                                                                                                                                                                      | Optional new capability — useful for audit logging, vault-write gating.                                                                                                         |
| Subagents (Task tool)   | Not exposed                                                                                                                                                                                         | `agents: { name: AgentDefinition }` + `Agent` tool; messages tagged with `parent_tool_use_id`                                                                                                                                                                                                                                                  | New capability; can ship later.                                                                                                                                                 |
| MCP support             | HTTP & SSE forwarded via ACP capabilities                                                                                                                                                           | Stdio, SSE, HTTP, **and SDK in-process**                                                                                                                                                                                                                                                                                                       | Equal/better. User-configured MCP servers carry over.                                                                                                                           |
| Streaming model         | `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan` notifications                                                                                                 | `SDKMessage` union: `system`, `assistant`, `user`, `stream_event` (with `content_block_start/delta/stop` carrying `text_delta`, `thinking_delta`, `input_json_delta`), `tool_progress`, `result`. Enable with `includePartialMessages: true`.                                                                                                  | Largest translation effort — see §3.                                                                                                                                            |
| Reasoning / thinking    | `agent_thought_chunk` text deltas; opaque "effort" config option per backend                                                                                                                        | `thinking: { type: "enabled", budgetTokens } \| { type: "adaptive" } \| { type: "disabled" }`; deltas via `stream_event.thinking_delta`                                                                                                                                                                                                        | Cleaner model. The existing `ReasoningBlock.tsx` rendering still works — only the source events differ.                                                                         |
| Plan mode               | First-class `plan` notification + `ExitPlanMode` permission switch_mode (gated card UI)                                                                                                             | `permissionMode: "plan"` + `ExitPlanMode` tool whose input contains the plan text. **Caveat:** `EnterPlanMode` is auto-approved by the SDK and never hits `canUseTool` — must be detected from the assistant stream to sync UI. `ExitPlanMode` does go through `canUseTool`.                                                                   | The streaming plan card consumes `input_json_delta` for `ExitPlanMode` tool_use blocks; floating proposal card flow stays. Add stream-side detection for `EnterPlanMode`.       |
| Model selection         | `setSessionModel()` returns backend-defined list                                                                                                                                                    | `query.supportedModels()`, `query.setModel()`, `model: "opus" \| "sonnet" \| "haiku" \| "claude-opus-4-7" \| ...`, `fallbackModel`                                                                                                                                                                                                             | Simpler, single source of truth.                                                                                                                                                |
| Provider selection      | Backend choice (Claude, Opencode, Codex)                                                                                                                                                            | Anthropic API, Bedrock, Vertex, Foundry — via env vars (`CLAUDE_CODE_USE_BEDROCK=1` etc.)                                                                                                                                                                                                                                                      | Loses non-Anthropic _agents_ (Opencode/Codex), keeps non-Anthropic _cloud providers_ for Claude itself.                                                                         |
| Sessions                | Per-spawn session id; no list/resume API                                                                                                                                                            | `listSessions()`, `getSessionMessages()`, `getSessionInfo()`, `renameSession()`, `tagSession()`; resume via `resume: id`, fork via `forkSession: true`, `rewindFiles()`                                                                                                                                                                        | New capability that maps well to the existing per-project `MessageRepository`.                                                                                                  |
| Slash commands / Skills | Not surfaced                                                                                                                                                                                        | Filesystem-loaded from `.claude/commands/`, `.claude/skills/`; `query.supportedCommands()`                                                                                                                                                                                                                                                     | Optional. Not relevant inside a vault.                                                                                                                                          |
| AskUserQuestion         | **Not supported**                                                                                                                                                                                   | Built-in tool with multi-choice options. Resolved entirely via `canUseTool` callback — no separate hook or MCP tool override.                                                                                                                                                                                                                  | New modal. Host renders questions, returns `{ behavior: "allow", updatedInput: { questions, answers } }`. See §2.                                                               |
| Interrupt / stop        | Backend-specific cancel                                                                                                                                                                             | `query.interrupt()`, `query.stopTask(taskId)`                                                                                                                                                                                                                                                                                                  | Replaces current cancel wiring.                                                                                                                                                 |
| Mobile                  | Already excluded (`Platform.isMobile` gate in `main.ts:137`)                                                                                                                                        | Same constraint — needs Node subprocess                                                                                                                                                                                                                                                                                                        | No regression.                                                                                                                                                                  |

---

## 2. Recommended target architecture

Keep the upper layers intact. Replace only the backend bridge.

```
ChatUIState ── unchanged
   │
ChatManager ── unchanged
   │
AgentSession ── thinned: still owns turn state, message store, plan/permission resolvers,
   │            but its event-handling switch is rewritten against SDKMessage instead of SessionNotification
   │
ClaudeSdkBackend (NEW) ── wraps `query()` from @anthropic-ai/claude-agent-sdk:
   │   - constructs Options per session (model, permissionMode, thinking, hooks, mcpServers, canUseTool,
   │     pathToClaudeCodeExecutable from claudeBinaryResolver)
   │   - exposes a small interface: start(prompt), interrupt(), setModel(), setPermissionMode(), close()
   │   - translates SDKMessage stream → AgentSession's existing internal event vocabulary
   │
ClaudeBinaryResolver (NEW) ── locates the user-installed `claude` CLI across Volta/asdf/NVM/Homebrew/
   │                          npm-global on macOS/Linux/Windows. Returns absolute path or null. Settings
   │                          can override.
   │
VaultMcpServer (NEW) ── createSdkMcpServer({ name: "obsidian-vault", tools: [...] })
       Read / Write / Edit / Glob / Grep / List against `app.vault.adapter`
       Disallow SDK's built-in Read/Write/Edit via `disallowedTools` so Claude only uses these
```

### Why a vault MCP server, not built-in tools

The SDK's built-in `Read/Edit/Write` operate on the OS filesystem at the subprocess `cwd`. Vault files _are_ on disk, but Obsidian owns:

- File-write event propagation (other plugins, sync)
- Frontmatter and link maintenance
- Encryption / cloud-sync drivers that may not have a stable on-disk path
- Rename and move semantics

Routing through `vault.adapter.read/write/list` keeps the agent inside Obsidian's contract. The SDK's `disallowedTools: ["Read", "Write", "Edit"]` (or `tools: { type: "preset", preset: "claude_code" }` minus those) ensures Claude only sees the vault tools.

### Permission model

`canUseTool` callback delegates to the existing modal. Map:

- ACP `allow_once` → `{ behavior: "allow" }`
- ACP `allow_always` → `{ behavior: "allow", updatedPermissions: [{ ...add to allowlist }] }`
- ACP `reject_once` → `{ behavior: "deny", message: "User declined" }`
- ACP `reject_always` → `{ behavior: "deny", message, updatedPermissions: [{ ...add to denylist }] }`

`ExitPlanMode` is a built-in SDK tool. The plan-proposal card subscribes to the partial `input_json_delta` for `ExitPlanMode` tool_use blocks (gives streaming plan text), and approval is gated by `canUseTool` returning allow/deny. The current `PlanProposalCard` UX is preserved.

### AskUserQuestion

Resolved by the Day-1 spike (§4.5). Single-mechanism: the `canUseTool` callback. When `canUseTool` is invoked with `toolName === "AskUserQuestion"`:

- `input.questions: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }>`
- Open a new modal (or reuse the `AgentPermissionModal` chassis), render the questions, collect selections.
- Return:
  ```ts
  return {
    behavior: "allow",
    updatedInput: {
      questions: input.questions,
      answers: { [questionText]: "label" /* or "label1, label2" for multiSelect */ },
    },
  };
  ```
- The SDK then completes the tool call with those answers — no separate hook, MCP override, or `toolConfig` field needed.

The wider `canUseTool` signature is `(toolName, input, { signal, suggestions?, blockedPath?, decisionReason?, title?, displayName?, description?, toolUseID, agentID? }) => Promise<PermissionResult>` — the extra fields are useful UX inputs for the modal.

---

## 3. File-level migration plan

### Files to delete

Scope is narrow: only the `claude-code-acp` backend is removed. Everything in `acp/`, the registry, `opencode/`, `codex/`, and `OpencodeBinaryManager.ts` stays.

- `src/agentMode/backends/claude-code/` — the entire `claude-code-acp` backend folder (`ClaudeCodeBackend.ts`, `descriptor.ts`, `index.ts`, any backend-specific UI). The new SDK backend lives under `src/agentMode/sdk/` and registers a fresh descriptor.
- `claude-code` entry in `src/agentMode/backends/registry.ts` — replaced by the SDK-backed registration. The registry itself stays.
- `claude-code` settings slice: `agentMode.backends["claude-code"]`. Migrated to `agentMode.claudeCli.path` (per §3 "Settings migration" below). The `opencode` and `codex` slices are untouched.
- `src/agentMode/ui/AcpPermissionModal.tsx`: kept under its current name; the new SDK backend's permission bridge reuses it. (Earlier drafts proposed a rename; not needed since ACP is still in the tree.)

### Files to add

- `src/agentMode/sdk/ClaudeSdkBackend.ts` — wraps `query()`, owns the async generator loop, exposes `start/interrupt/setModel/setPermissionMode/close` and a typed event emitter consumed by `AgentSession`. Always sets `pathToClaudeCodeExecutable` from `claudeBinaryResolver`.
- `src/agentMode/sdk/sdkMessageTranslator.ts` — pure module: maps `SDKMessage` → the internal events `AgentSession` already understands (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `permission_request_resolved`, `result`). **Must also detect `EnterPlanMode` tool_use blocks in the assistant stream** (the SDK auto-approves it — never hits `canUseTool`). Keep this leaf-pure (no singletons) per the dependency-chain rule in `CLAUDE.md`.
- `src/agentMode/sdk/vaultMcpServer.ts` — `createSdkMcpServer` with vault-adapter-backed tools: `vault_read`, `vault_write`, `vault_edit`, `vault_glob`, `vault_grep`, `vault_list`. Each tool takes the vault as a parameter (not a singleton).
- `src/agentMode/sdk/permissionBridge.ts` — `canUseTool` implementation that defers to existing modal/plan-proposal handlers in `AgentSession`. Branches on `toolName === "AskUserQuestion"` to open the AskUserQuestion modal instead.
- `src/agentMode/sdk/claudeBinaryResolver.ts` — pure module that locates the `claude` CLI on the user's system. Search order: user-configured override → `~/.claude/local/claude` → `~/.local/bin/claude` → `~/.volta/bin/claude` → `~/.asdf/{shims,bin}/claude` → `/usr/local/bin/claude` → `/opt/homebrew/bin/claude` → `~/.npm-global/bin/claude` → `npm_config_prefix/bin/claude` → resolved NVM default (NVM_BIN isn't exported to GUI apps so fall back to reading `~/.nvm/alias/default`) → `cli.js` under `npm-global/lib/node_modules/@anthropic-ai/claude-code/`. **Windows:** prefer `claude.exe`, then `cli.js`; **never** fall back to `.cmd` wrappers — they need `shell: true` and break SDK stdio streaming. Returns absolute path or `null`. No singletons; takes settings as a parameter.
- `src/agentMode/ui/AskUserQuestionModal.tsx` — new modal for multi-choice questions. Returns `{ [questionText]: string }`; for `multiSelect: true`, joins selected labels with `", "`.
- `scripts/patchRendererUnsafeUnref.js` — esbuild post-bundle plugin that rewrites `setTimeout(...).unref()` to `setTimeout(...); .unref?.()` inside the bundled `main.js`. **Required**: the SDK's process-transport-close path (`@anthropic-ai/claude-agent-sdk`) and the MCP SDK's stdio-close-wait (`@modelcontextprotocol/sdk`) both call `.unref()` on timers, which crashes Electron's renderer process. Must include a verifier that fails the build if any unsafe sites remain. The two known unsafe sites are documented in §4.5 Q3.

### Files to modify

- `src/agentMode/session/AgentSession.ts` — **only** the code paths exercised by the new SDK backend change. `AgentSession` already routes by `BackendDescriptor`; the existing ACP-side handling for `opencode`/`codex` stays. The new SDK backend's message stream goes through a new translator module (see "Files to add") rather than ACP's `SessionNotification` switch. Lifecycle methods (`start`, `setSessionModel`, `setSessionMode`, etc.) gain SDK-specific branches alongside the ACP branches.
- `src/agentMode/backends/registry.ts`: swap the `claude-code` entry to the new SDK descriptor; leave `opencode` and `codex` entries untouched. The registry shape itself doesn't change.
- `src/agentMode/index.ts`: register the new SDK backend descriptor; do **not** remove the multi-backend wiring.
- `src/main.ts` (`:137-140`): unchanged — still desktop-only.
- `src/agentMode/ui/permissionPrompter.ts`: gains an SDK-permission entry path; the ACP path is unchanged.
- `src/components/agent/*` (ActionCard, ReasoningBlock, agentTrail, toolSummaries, toolIcons): no required changes if ACP types stay (they will). The new SDK backend will translate SDK events into the same internal event vocabulary the components already consume.
- `src/agentMode/session/AgentChatPersistenceManager.ts`: unchanged.
- `src/settings/v2/components/AdvancedSettings.tsx`: add (a) "Claude CLI path" override field (auto-detected via `claudeBinaryResolver`, with a "Re-detect" button and a status pill `Found at <path>` / `Not found — install with npm install -g @anthropic-ai/claude-code`); (b) Anthropic credential / provider env display (read-only). Keep the OpenCode/Codex backend path fields and the ACP frame-log toggle.
- `esbuild.config.mjs` — register the renderer-unsafe-unref patch plugin (added in §3 Files to add). Verify on every build that no unsafe `setTimeout(...).unref()` sites remain.
- `package.json`:
  - **Keep** `@agentclientprotocol/sdk` — still used by `opencode` and `codex` backends.
  - **Add** `@anthropic-ai/claude-agent-sdk` (≥ 0.2.111 for Opus 4.7; current `0.2.126`). Pulls in `@anthropic-ai/sdk@^0.81.0` and `@modelcontextprotocol/sdk@^1.29.0` as transitive deps. Peer dep `zod@^4.0.0` — verify our existing zod version; bump if on zod 3.

### Settings migration

Existing users have:

- `agentMode.backends.{claude-code|opencode|codex}.*` paths

Migration: the `claude-code` slice's `binaryPath` is read once and copied to the new `agentMode.claudeCli.path` override (used by `claudeBinaryResolver` if set, otherwise auto-detect), then the legacy `claude-code` slice is dropped. The `opencode` and `codex` slices are **kept as-is** — those backends still run on ACP. On first agent-mode launch under the new version, run the resolver and surface its result in settings. Surface `ANTHROPIC_API_KEY` (or Bedrock/Vertex env) status alongside.

---

## 4. Open questions

1. **Vault-tool naming visible to Claude.** Settled by the architecture: disallow built-in `Read`/`Write`/`Edit` via `disallowedTools` so Claude can't call them. The vault tools (`vault_read`, etc.) are then the only option in their category — no system-prompt nudge needed.
2. **Hook usage for audit and gating.** Likely worth wiring `PostToolUse` for vault-write logging into `.copilot/agent-audit.log` even on day one — cheap insurance against runaway edits. Decide during implementation; not a blocker.
3. **`settingSources: ['project']` to load `CLAUDE.md`?** The SDK can pick up vault-side `CLAUDE.md` files. Default to `[]` (don't load) to keep behavior local; offer a settings toggle for project mode users who want it.
4. **Runtime binary download fallback (Option B from §4.5).** Should we ship a fallback that downloads `@anthropic-ai/claude-agent-sdk-{platform}` (~206 MB) into the vault data dir if `claude` isn't on PATH, mirroring `OpencodeBinaryManager`? Defer until v1 ships and we have onboarding-friction signal.

## 4.5. Resolved by Day-1 spike (2026-05-01)

**Q1. AskUserQuestion rendering ownership.** Resolved: single mechanism — `canUseTool` callback. When `toolName === "AskUserQuestion"`, host opens its own modal, returns `{ behavior: "allow", updatedInput: { questions, answers } }`. No hook, no MCP override, no `toolConfig` previewFormat. Confirmed by Anthropic SDK docs (permissions guide) and the `CanUseTool` type in `sdk.d.ts`. See §2 "AskUserQuestion" for the input/output shape.

**Q2. Bundled binary on Obsidian/Electron.** Resolved: the SDK _publishes_ a per-platform native binary (`@anthropic-ai/claude-agent-sdk-{platform}` at v0.2.126 ships a real ~206 MB binary), but auto-discovery uses `import.meta.url` + path resolution to find sibling `cli.js` and breaks under any bundler that virtualizes module paths (esbuild, bun, webpack). Documented Anthropic-side: GitHub issues [#150](https://github.com/anthropics/claude-agent-sdk-typescript/issues/150) (bundling breaks discovery) and [#205](https://github.com/anthropics/claude-agent-sdk-typescript/issues/205) (`pathToClaudeCodeExecutable` PATH lookup fix). For Obsidian plugins this is doubly broken because we don't ship `node_modules/` at all. **Decision:** always set `pathToClaudeCodeExecutable` from `claudeBinaryResolver`. Option A (rely on user-installed `claude` CLI, surface a clear onboarding check) is the v1 path. Option B (plugin-managed runtime download) is a future enhancement; tracked as Q4 above. Option C (bundle binaries in plugin release) is rejected — ~1.6 GB across all platforms exceeds reasonable Obsidian community-plugin distribution size.

**Q3. Electron renderer compatibility (new finding from spike).** The SDK's process-transport-close path and the MCP SDK's stdio-close-wait both call `.unref()` on `setTimeout` handles. `.unref()` is unsafe in Electron's renderer process and will crash the plugin under teardown. Mitigation: an esbuild post-bundle patch that rewrites `setTimeout(...).unref()` → `setTimeout(...); .unref?.()`, plus a verifier that fails the build if unsafe sites remain. The two known patterns (regex-matchable):

1. `@anthropic-ai/claude-agent-sdk` process-transport close: a `setTimeout(...).unref()` guarding a `SIGTERM` → 5 s → `SIGKILL` ladder, paired with a `process.once("exit", ...)`.
2. `@modelcontextprotocol/sdk` stdio close wait: a `new Promise(resolve => setTimeout(resolve, 2e3).unref())` 2-second drain.

New file in §3 (`scripts/patchRendererUnsafeUnref.js`).

**Q4. EnterPlanMode handling (new finding from spike).** `EnterPlanMode` is auto-approved by the SDK and never hits `canUseTool`. The runtime must detect it from the assistant tool_use stream to keep the UI in sync (mode badge, plan card priming). `ExitPlanMode` does flow through `canUseTool` and gates the plan-proposal approval. Reflected in `sdkMessageTranslator` responsibilities under §3.

---

## 5. Effort estimate

Categorized by risk × surface, not raw line count.

| Block                                                                                 | Effort                   | Risk                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| Delete ACP/backend/process layer + settings                                           | 1 day                    | Low — straightforward removal                                                      |
| `ClaudeSdkBackend` + `sdkMessageTranslator` (incl. `EnterPlanMode` stream detection)  | 2–3 days                 | Medium — translation correctness for streaming + tool-call deltas needs unit tests |
| `vaultMcpServer` (6 tools, vault.adapter-backed)                                      | 1–2 days                 | Low — trivial wrappers + tests                                                     |
| `permissionBridge` + plan-proposal rewire                                             | 1 day                    | Low                                                                                |
| `AskUserQuestionModal` (mechanism known)                                              | 1 day                    | Low — `canUseTool` interception confirmed by spike                                 |
| `claudeBinaryResolver` + onboarding "Claude CLI not found" UI                         | 0.5–1 day                | Low — Windows-`.cmd` and NVM-GUI cases the only subtlety                           |
| esbuild renderer-unref patch + build verifier                                         | 0.5 day                  | Low — verify on macOS, Windows, Linux                                              |
| `AgentSession` switch + UI component import fixes                                     | 2 days                   | Medium — large file, subtle order-of-event bugs likely                             |
| Settings migration + onboarding UI cleanup                                            | 0.5 day                  | Low                                                                                |
| Manual QA in Obsidian (turn-taking, plan mode, permission edge cases, MCP forwarding) | 1 day                    | —                                                                                  |
| **Total**                                                                             | **~9.5–12 working days** |                                                                                    |

Front-loaded checkpoints:

- **Day 1 spike** ✓ Completed 2026-05-01. Findings folded into §4.5. Three concrete go-decisions: (1) require user-installed `claude` CLI for v1, (2) `canUseTool`-only AskUserQuestion path, (3) ship the renderer-unref esbuild patch.

---

## 6. Milestones

Five milestones, each independently testable. The work behind a feature flag (`agentMode.useSdkBackend`) until M5 cutover so we never break the shipped ACP path.

### M1 — Build foundation (1–1.5 days)

**Goal:** SDK is in the bundle and the bundle is renderer-safe. No behavior change yet.

**Deliver:**

- `package.json`: add `@anthropic-ai/claude-agent-sdk` (≥ 0.2.111). Verify `zod` peer ≥ 4.0.0; bump if needed.
- `scripts/patchRendererUnsafeUnref.js` + esbuild integration in `esbuild.config.mjs` covering both unsafe `.unref()` patterns from §4.5 Q3.
- `src/agentMode/sdk/claudeBinaryResolver.ts` (pure leaf module, takes settings as a parameter).
- Resolver unit tests covering: explicit override, common Unix paths, NVM-default fallback, Windows `.exe`/`cli.js` precedence, `.cmd` rejection, "not found" → null.

**How to test:**

- `npm run build` succeeds. Build asserts no `setTimeout(...).unref()` sites remain in `main.js` (build fails if patch missed any).
- `npm run test` — resolver unit tests green.
- Manual: launch Obsidian; existing ACP agent mode still works (no functional regression). Confirm the bundled `main.js` size hasn't ballooned unexpectedly (SDK sources only, no native binary).
- Manual on macOS, Windows, Linux: open dev console, eval `claudeBinaryResolver` against the host filesystem; confirm it returns the expected `claude` path on each.

**Exit criteria:** Build green, ACP unchanged in user-facing behavior, resolver returns correct paths in all three OS dev environments.

### M2 — Backend bring-up behind a flag (3–4 days)

**Goal:** A new `ClaudeSdkBackend` can drive a basic streaming text turn end-to-end, gated by a hidden setting. ACP remains the default.

**Deliver:**

- `src/agentMode/sdk/ClaudeSdkBackend.ts` — wraps `query()`; exposes `start/interrupt/setModel/setPermissionMode/close`. Always sets `pathToClaudeCodeExecutable`.
- `src/agentMode/sdk/sdkMessageTranslator.ts` — pure translator from `SDKMessage` → internal events. Includes `EnterPlanMode` tool_use detection (auto-approved by SDK; surfaced to UI from the stream).
- Translator unit tests covering: `text_delta`, `thinking_delta`, `input_json_delta` for tool-use, `result` message, `EnterPlanMode` detection, partial-message reassembly, interrupt mid-stream.
- Hidden setting `agentMode.useSdkBackend` (default `false`); `AgentSession.start()` branches on it. With the flag off, ACP behavior is byte-identical.

**How to test:**

- `npm run test` — translator unit tests green; assert event-shape parity against fixtures captured from the existing ACP path for equivalent prompts.
- Manual with flag on: send a plain text prompt ("write a haiku"). Streaming text and reasoning blocks render in the existing UI; turn ends cleanly with a `result` event; `Cancel` mid-stream halts the turn.
- Manual: toggle flag off → ACP path still works. Toggle on → SDK path works. No state leakage between sessions.
- Confirm via Obsidian dev console that the spawned `claude` process exits when the chat view closes (no zombie subprocesses).

**Exit criteria:** Flag-on can complete a non-tool conversation indistinguishably from ACP at the chat-UI level; flag-off is unchanged.

### M3 — Vault MCP server + permissions + plan mode (2–3 days)

**Goal:** SDK path can do real agent work — read/write the vault, prompt for permissions, enter and exit plan mode.

**Deliver:**

- `src/agentMode/sdk/vaultMcpServer.ts` — `createSdkMcpServer` with `vault_read/write/edit/glob/grep/list` tools wired to `app.vault.adapter`. Each tool takes the vault as a parameter; no singletons.
- `src/agentMode/sdk/permissionBridge.ts` — `canUseTool` that defers to the existing modal (renamed `AgentPermissionModal`). Maps the four ACP permission outcomes to `{ behavior, updatedPermissions? }`.
- Plan-proposal flow: `ExitPlanMode` tool_use input deltas feed the floating `PlanProposalCard`; `canUseTool` allow/deny gates approval.
- `disallowedTools: ["Read","Write","Edit"]` in the SDK options so the agent only sees vault tools.
- Vault MCP unit tests covering: read of existing/missing file, write creating new file, edit with stale anchor (should fail), glob/grep against a small fixture vault.

**How to test:**

- `npm run test` — vault MCP unit tests green.
- Manual (flag on): "summarize my note `<some-note>.md`" — confirm the agent calls `vault_read`, modal does _not_ appear (read is auto-approved per existing policy), summary streams.
- Manual: "rename heading X to Y in `<note>.md`" — confirm modal appears for `vault_edit`, allow → file updates via the vault adapter (verify with an Obsidian event listener in dev console: the edit fires `vault.on("modify")`, sync clients see the change).
- Manual: enable plan mode, ask a multi-step task. Floating plan card streams plan text from `ExitPlanMode` input deltas. Approve → permission mode flips and execution proceeds; reject → turn ends.
- Manual: reject a permission, then re-trigger the same tool — confirm the deny is one-shot (not sticky).

**Exit criteria:** Flag-on agent can do read/write/edit on the vault end-to-end with permissions; plan mode enters and exits cleanly.

### M4 — AskUserQuestion + onboarding UI (1–1.5 days)

**Goal:** New SDK-only capability and the user-facing surfaces to make the SDK path pleasant to land on.

**Deliver:**

- `src/agentMode/ui/AskUserQuestionModal.tsx` — multi-choice modal. Output shape per §2: `{ [questionText]: "label" | "label1, label2" }`.
- `permissionBridge` branches on `toolName === "AskUserQuestion"` to open the modal and return `{ behavior: "allow", updatedInput: { questions, answers } }`.
- Onboarding UI in `AdvancedSettings.tsx`: "Claude CLI" status row (auto-detect via resolver) with `Found at <path>` / `Not found — install with npm install -g @anthropic-ai/claude-code` and a "Re-detect" button. Manual override field.
- ANTHROPIC_API_KEY / Bedrock / Vertex env status display (read-only).

**How to test:**

- Manual: prompt Claude with deliberate ambiguity ("plan my week" with no context) and `tools` allowing `AskUserQuestion` — modal opens with the questions, selections round-trip and the turn continues with the chosen answer threaded into context.
- Manual: multi-select question — verify selecting two options yields `"label1, label2"` in `updatedInput.answers` and the agent receives both.
- Manual: cancel the modal — confirm the SDK turn errors gracefully with a "user cancelled" surfaced to chat (not a hang).
- Manual onboarding: rename the `claude` binary out of PATH and reload Obsidian. Settings shows "Not found"; click "Re-detect" still says not found; type a custom path → status flips to "Found at `<path>`"; agent turn succeeds.
- Manual NVM case: install via `nvm install --lts && npm install -g @anthropic-ai/claude-code`. Resolver finds the binary even though `NVM_BIN` isn't exported to Obsidian (GUI app).
- Manual Windows case: confirm resolver picks `claude.exe` when present; if only `cli.js` exists, picks that; never picks the `.cmd` wrapper.

**Exit criteria:** Flag-on agent can ask AskUserQuestion turns; new install on a clean machine reaches a working state via the onboarding UI alone.

### M5 — Cutover and cleanup (1–1.5 days)

**Goal:** SDK is the active path for the Anthropic backend. The legacy `claude-code-acp` shim is deleted. `opencode` and `codex` backends keep running on ACP, untouched.

**Deliver:**

- Flip `agentMode.useSdkBackend` default to `true`; remove the flag.
- Delete only the Anthropic-shim backend: `src/agentMode/backends/claude-code/` (the entire folder), and remove the `claude-code` entry from `src/agentMode/backends/registry.ts`. Replace it with the new SDK descriptor registration.
- Settings migration: read once `agentMode.backends["claude-code"].binaryPath` → write `agentMode.claudeCli.path`, then drop the `claude-code` slice. Leave `agentMode.backends.opencode` and `agentMode.backends.codex` untouched.
- **Keep** `@agentclientprotocol/sdk` in `package.json` — still used by `opencode` and `codex`.
- **Keep** all ACP runtime modules (`src/agentMode/acp/*`, `OpencodeBinaryManager.ts`, the registry shape) and their tests.
- Update user-facing docs in `docs/` (`agent-mode-and-tools.md`): document the new SDK-backed Claude path and the `claude` CLI install requirement; OpenCode/Codex sections stay as-is.

**How to test:**

- `npm run lint && npm run format && npm run test` all green.
- Manual: open Obsidian with old settings populated — `claude-code.binaryPath` migrates to `claudeCli.path`; OpenCode/Codex slices unchanged; first SDK turn succeeds.
- Manual: switch active backend to `opencode` and to `codex`; both still spawn and stream as before.
- Manual: `grep -rn "claude-code-acp\|backends/claude-code" src/` returns nothing.
- Bundle size sanity check: `main.js` should grow by the SDK source size only.
- Re-run the full M2–M4 manual scenarios with the flag removed — behavior unchanged for SDK path; ACP backends regression-free.

**Exit criteria:** Anthropic backend runs on the SDK; OpenCode and Codex backends still run on ACP unchanged; existing-user upgrade works.

### M6 — Final QA pass (1 day)

**Goal:** Run §7 (was §6) end-to-end verification on macOS, Windows, and Linux. Fix any defects found.

Outcome documented in a release-readiness note before merging the migration PR.

---

## 7. Verification

End-to-end test plan after migration:

1. **Onboarding**: Fresh Obsidian install with no `claude` binary on `$PATH`. Open agent mode → settings shows "Claude CLI: Not found" with the `npm install -g @anthropic-ai/claude-code` hint. Install per docs, click "Re-detect" → status flips to "Found at `<path>`". Set `ANTHROPIC_API_KEY`. First message succeeds.
   1a. **Onboarding under NVM**: install `claude` via NVM-managed Node. Confirm resolver finds it via `~/.nvm/alias/default` even though `NVM_BIN` isn't exported to GUI apps. Same flow on Windows with `.exe` and `cli.js` paths; verify resolver doesn't pick a `.cmd` wrapper.
2. **Vault tool isolation**: Ask Claude to read a note and modify it. Confirm via `app.vault.adapter` event listener that the write went through the vault, not direct disk. Confirm sync clients see the update.
3. **Streaming**: Long-response prompt. Verify text deltas, thinking deltas, and tool-call argument deltas all populate the existing UI components.
4. **Permission modal**: Trigger a destructive operation (e.g., delete-note tool). Confirm modal appears, allow/deny outcomes both round-trip correctly.
5. **Plan mode**: Set `permissionMode: "plan"`, ask a multi-step task. Confirm `ExitPlanMode` triggers the floating plan card with streamed content; approve/reject both work.
6. **AskUserQuestion**: Prompt Claude with an ambiguous instruction it should clarify. Confirm modal appears with multi-choice options; selected answer threads back into the turn.
7. **Interrupt**: Mid-stream press cancel. Confirm `query.interrupt()` halts cleanly and chat state is consistent.
8. **MCP passthrough**: Configure a user-defined HTTP MCP server in settings. Confirm Claude can call it (still works under the SDK's `mcpServers` option).
9. **Sessions**: Restart Obsidian, resume a project. Confirm chat history loads via existing `MessageRepository` path; new turn continues where left off.
10. **Settings migration**: Open the plugin with old `agentMode.backends.*` settings populated. Confirm clean migration to v3 settings without crashing.

Local commands (per `CLAUDE.md`):

- `npm run lint && npm run format`
- `npm run test` for unit tests on `sdkMessageTranslator`, `vaultMcpServer`, and `claudeBinaryResolver`
- Verify the renderer-unref patch removed all `setTimeout(...).unref()` sites in the bundled `main.js` (build script asserts this)
- Manual reload via `/Applications/Obsidian.app/Contents/MacOS/obsidian plugin:reload id=copilot` after `npm run build` (user-driven)
