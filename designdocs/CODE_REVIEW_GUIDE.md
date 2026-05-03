# Branch review guide — `zero/acp-test`

## Context

One week of vibe-coded work that adds **Agent Mode** to the plugin: a chat
surface that drives external coding agents (OpenCode, Codex, Claude). The
branch is large (160 files, +31k / −9k LOC across 42 commits) but the
architecture is clean — four layers with ESLint-enforced boundaries
(`src/agentMode/AGENTS.md`).

This is a **review tour by architectural concern**, not by commit
chronology. Read in this order; each group is sized for one or two
sittings.

---

## Architecture in one diagram

```
                     ┌────────────────────────────────────┐
                     │            Host plugin              │
                     │  (main.ts, CopilotView, ChatInput)  │
                     └─────────────────┬──────────────────┘
                                       │  only via @/agentMode barrel
                     ┌─────────────────▼──────────────────┐
                     │                ui/                  │   GROUP 5
                     │  Backend-agnostic React; reads      │
                     │  BackendDescriptor                  │
                     └─────────────────┬──────────────────┘
                                       │
                     ┌─────────────────▼──────────────────┐
                     │             session/                │   GROUP 4
                     │  Turn state machine, message store, │
                     │  multi-tab, persistence, adapters   │
                     │  (mode/effort/MCP/model)            │
                     └─────────────────┬──────────────────┘
                                       │  AcpBackend interface
                     ┌─────────────────▼──────────────────┐
                     │           backends/<id>/            │   GROUP 3
                     │  opencode, codex, claude            │
                     │  Install + BYOK + settings + descriptor
                     └────────┬───────────────────┬───────┘
                              │                   │
                ┌─────────────▼─────┐   ┌────────▼────────┐
                │       acp/         │   │      sdk/        │   GROUP 2
                │  JSON-RPC over     │   │  In-process      │
                │  stdio subprocess  │   │  Claude Agent    │
                │                    │   │  SDK iterator    │
                └────────────────────┘   └─────────────────┘
                  Transport: two implementations, one contract
```

The **contract** that ties this all together (Group 1) lives in
`session/types.ts` + `agentMode/AGENTS.md`. Read those first or nothing
else will land cleanly.

A **vertical slice** (Group 6 — plan mode & permissions) crosses every
layer above; it's worth reading after you've seen the layers in
isolation.

---

## Group 1 — The contract (start here)

**Why first:** every other file conforms to interfaces declared here. If
you read these in any other order, you'll re-derive them yourself as you
go.

**Files (~700 lines total):**

- `src/agentMode/AGENTS.md` — layer rules, descriptor surface, debug tips
  (100 lines, the spec)
- `src/agentMode/session/types.ts` — **the central vocabulary**: the
  `AcpBackend` interface, `BackendDescriptor`, `InstallState`, the event
  union the session emits to the UI (528 lines)
- `src/agentMode/index.ts` — public surface (one barrel; nothing outside
  agentMode is allowed to deep-import past this)
- `src/agentMode/backends/registry.ts` — the only file you edit when
  adding a new backend (32 lines)
- `.eslintrc` — find the `boundaries/element-types` block; this is what
  enforces the layering at lint time

**Validate understanding:** can you describe (a) what `AcpBackend` exposes
to `session/`, (b) what `BackendDescriptor` exposes to `ui/`, and (c) why
those two interfaces are different?

---

## Group 2 — Agent transport (two runtimes, one contract)

**Why grouped together:** ACP and the Claude Agent SDK are the same
architectural layer — both translate "an external agent's event stream"
into the session's internal event vocabulary, and both implement
`AcpBackend`. They look like sibling implementations even though they
were built weeks apart, and reading them side-by-side is the fastest way
to see what the contract actually buys you.

**The shared shape both runtimes expose to `session/`:** `start(prompt)`,
`interrupt()`, `setModel()`, `setPermissionMode()`, `close()`, plus a
stream of `AcpEvent`-typed notifications.

### 2a. ACP runtime — JSON-RPC subprocess

`src/agentMode/acp/`

- `types.ts` — ACP wire-format types
- `AcpProcessManager.ts` — subprocess spawn / lifecycle
- `AcpBackendProcess.ts` — JSON-RPC frame loop + ACP event translation
  (445 lines, the central file)
- `VaultClient.ts` — host-side handler for the agent's `fs/*` requests
  (this is how the agent reads/writes vault files via the host, not the
  OS filesystem)
- `frameSink.ts` + `debugTap.ts` — opt-in NDJSON frame log
- `nodeShebangPath.ts` — CLI shebang resolution

### 2b. Claude SDK runtime — in-process query iterator

`src/agentMode/sdk/`

- `ClaudeSdkBackendProcess.ts` — `AcpBackend` implementation that wraps
  `query()` from `@anthropic-ai/claude-agent-sdk` (559 lines, the
  central file)
- `sdkMessageTranslator.ts` — translates `SDKMessage` stream → the same
  internal event vocabulary the ACP path uses (this is what lets
  `session/` stay unchanged across both runtimes)
- `vaultMcpServer.ts` — in-process MCP server wrapping `app.vault.adapter`
  so writes flow through Obsidian (file watchers, links, sync). The
  SDK's built-in Read/Write/Edit are explicitly disallowed.
- `permissionBridge.ts` — translates the SDK's `canUseTool` callback into
  the existing permission flow, including new `AskUserQuestion` handling
- `claudeBinaryResolver.ts` — locates the user-installed `claude` CLI
  across Volta/asdf/NVM/Homebrew/npm-global on macOS/Linux/Windows
- `sdkDebugTap.ts` — SDK-side equivalent of ACP's frame log

**Companion docs:**

- `designdocs/todo/CLAUDE_AGENT_SDK_MIGRATION.md` — capability diff and
  why the SDK path was added alongside ACP rather than replacing it.
  Read §1 (capability table) and §2 (target architecture).

**Validate:** turn on full ACP frame logging (Settings → Advanced), run a
turn on opencode and a turn on claude. The internal events emitted to
`session/` should look the same shape; only the inputs differ.

---

## Group 3 — Backend catalog (which agents exist, how they install)

**Why a separate group:** "how do we talk to an agent" (Group 2) and
"which specific agents do we ship" are different concerns. A backend
descriptor picks a transport, owns its install/binary story, exposes a
settings panel, and registers itself.

**The pattern (every backend has these):**

```
backends/<id>/
  descriptor.ts        — the BackendDescriptor export (settings glue,
                         install state, createBackend factory)
  <Id>Backend.ts       — implements AcpBackend (often a thin wrapper)
  <Id>InstallModal.tsx — onboarding UI (BYOK key, binary path)
  <Id>SettingsPanel.tsx — settings-page panel
  index.ts             — re-exports the descriptor
```

**Files:**

- `src/agentMode/backends/registry.ts` — already read in Group 1
- `src/agentMode/backends/_shared/` — common scaffolding three of the
  three backends use:
  - `simpleBinaryBackend.ts` — boilerplate for "user installs a CLI, we
    detect it and pass the path"
  - `BinaryInstallContent.tsx` — install-modal body
  - `SimpleBackendSettingsPanel.tsx` — settings-panel body
- `src/agentMode/backends/opencode/` — the **most complete example**;
  read this first. Includes:
  - `OpencodeBinaryManager.ts` (612 lines) — plugin-managed download +
    extract + verify (this is the only backend with a fully managed
    install)
  - `platformResolver.ts` — picks the right tarball per OS/arch
- `src/agentMode/backends/codex/` — minimal example (no managed binary)
- `src/agentMode/backends/claude/` — uses Group 2b (`sdk/`) instead of
  ACP. Includes `AskUserQuestionModal.tsx` (a capability ACP didn't
  have).
- `src/utils/detectBinary.ts` — generic binary-on-PATH detection used by
  the simple backend scaffold

**Validate:** open Settings → Agents tab. Switch active backend. Each
backend should expose its own install state, settings panel, and BYOK
fields without any other code changing.

---

## Group 4 — Session core (state machine + adapters)

**Why grouped together:** the state machine and the adapters are tightly
coupled. The adapters exist _because_ the session has to present a
uniform model/mode/effort UX over backends that disagree on what those
mean. Reading the state machine in isolation makes the adapters look
incidental, and vice versa.

### 4a. State machine

- `src/agentMode/session/AgentSession.ts` — **1301 lines, the heart**.
  Owns: turn state, message queue, plan/permission resolvers, interrupt,
  model/mode/effort changes, agent-supplied title, the event handler
  switch. Skim once for public methods, then read each event handler in
  sequence.
- `src/agentMode/session/AgentSessionManager.ts` — multi-tab orchestration
  (761 lines): per-tab session creation, active-session selection,
  cross-session lifecycle, persistence wiring
- `src/agentMode/session/AgentMessageStore.ts` — append-only store
- `src/agentMode/session/AgentChatUIState.ts` — React subscription bridge
- `src/agentMode/session/AgentChatBackend.ts` — small interface the
  session uses to talk to its current backend
- `src/agentMode/session/AgentChatPersistenceManager.ts` — debounced
  markdown auto-save, project-scoped file naming

### 4b. Cross-cutting adapters (per-backend normalizers)

- `session/modeAdapter.ts` — canonical `default | plan | yolo` modes
  mapped to per-backend strings
- `session/effortAdapter.ts` — reasoning effort levels per backend,
  including the `modelId#effort` encoding
- `session/mcpResolver.ts` — user-configured MCP servers (stdio/http/sse)
- `session/AgentModelPreloader.ts` — kicks model lists at plugin load
- `session/modelEnable.ts` — per-backend model curation
- `session/backendMeta.ts`, `session/backendSettingsAccess.ts` — small
  helpers
- `ui/useAgentModelPicker.ts` (445 lines) + `ui/agentModelPickerHelpers.ts`
  — the UI hook that consumes the adapters; lives in `ui/` but is
  conceptually part of this group
- `ui/McpServersPanel.tsx` — settings panel for `mcpResolver`

**Validate:** start two tabs on different backends, send messages in
both, change model mid-turn (it applies on next send), set per-backend
default mode, configure an MCP server. Reload the plugin — sessions
restore from disk.

---

## Group 5 — Chat surface UI (backend-agnostic)

**Why grouped:** all of `ui/` (minus the plan/permission vertical in
Group 6) is React rendering against the session layer. No file in here
imports from `acp/`, `sdk/`, or specific backends — only from `session/`
and `backends/registry.ts`.

### 5a. Shell

- `ui/CopilotAgentView.tsx` — Obsidian view registration
- `ui/AgentModeChat.tsx` — top-level chat surface
- `ui/AgentChat.tsx` (511 lines) — main chat container
- `ui/AgentChatControls.tsx` — header controls
- `ui/AgentTabStrip.tsx` — multi-session tabs
- `ui/AgentModeStatus.tsx` — install / connection status
- `ui/AgentChatMessages.tsx` — message list
- `ui/AgentMarkdownText.tsx` — markdown rendering helper

### 5b. Action-card trail (most recent UI rewrite)

The chronological trail of tool calls + reasoning + text:

- `ui/agentTrail.ts` — chronological merge of text/tool/reasoning parts
- `ui/AgentTrailView.tsx` — renderer
- `ui/ActionCard.tsx`, `AggregateCard.tsx`, `SubAgentCard.tsx` — card
  variants
- `ui/ReasoningBlock.tsx` + `components/chat-components/AgentReasoningBlock.tsx`
  — reasoning timer
- `ui/toolSummaries.ts` (+ test) + `toolIcons.ts` — per-tool one-liners
- `ui/diffRender.ts` — edit-tool diff display
- `ui/vaultPath.ts` — vault-relative path display

**Validate:** run a multi-tool turn (read + edit + bash). The trail
should show one card per tool call, reasoning blocks interleaved
chronologically, and a live timer on in-flight reasoning.

---

## Group 6 — Plan mode & permissions (vertical slice across all layers)

**Why a separate group:** this is the trickiest interaction surface in
the whole feature, and it crosses every layer. Reading it as a vertical
shows you how transport / session / UI cooperate around a single user
flow. Save it for after you understand the layers in isolation.

**The flow:** agent emits a `plan` notification → session creates a plan
proposal → UI renders the floating card → user approves → session sends
an `ExitPlanMode` permission → plan transitions into apply.

**Files (cross-layer):**

Transport side (Group 2):

- ACP: the `requestPermission` RPC handler in
  `acp/AcpBackendProcess.ts` and `permissionPrompter.ts`
- SDK: `sdk/permissionBridge.ts` (translates `canUseTool` callback,
  including `AskUserQuestion`)

Session side (Group 4):

- The plan / permission slices of `session/AgentSession.ts` (search for
  `plan`, `EnterPlanMode`, `ExitPlanMode`)

UI side:

- `ui/permissionPrompter.ts` — routing layer; special-cases
  `ExitPlanMode` switch_mode
- `ui/AcpPermissionModal.tsx` — generic permission modal
- `ui/PlanProposalCard.tsx` — inline plan card
- `ui/PlanPreviewView.tsx` — full-screen plan preview (custom Obsidian
  view registered in `main.ts`)
- `ui/planEntryStyles.ts`
- `backends/claude/AskUserQuestionModal.tsx` — Claude-only
  multi-choice question modal

**Known landmines fixed in this branch:** ghost plan card on late
`tool_call_update` (`e5b1dcb`), markdown class on plan preview
(`060e7d5`).

**Validate:** trigger a multi-step task in plan mode. Card renders →
preview opens → approve → session transitions into apply. No ghost card
on late events.

---

## Group 7 — Host integration & settings (the outer seam)

**Why last:** these are the files outside `agentMode/` that hook the
feature into the plugin. Reading them last is correct; the layered
mental model has to be in your head first or you'll mistake plumbing for
architecture.

**Plugin entry & view registration:**

- `src/main.ts` (193-line diff) — `createAgentSessionManager()` call,
  view registration (chat + plan-preview), mobile gate, lifecycle
- `src/components/CopilotView.tsx` — agent-mode chat-surface mounting

**Chat input integration:**

- `src/components/chat-components/ChatInput.tsx` — agent-mode-aware input
  (queue messages while a turn runs, ESC to stop, Shift-Tab to cycle
  modes)
- `src/components/chat-components/ChatModeInput.tsx` — extracted
  agent-mode toggle wrapper
- `src/components/chat-components/ChatMessages.tsx`,
  `AgentReasoningBlock.tsx`,
  `BottomLoadingIndicator.tsx`,
  `attachChatViewLayoutObservers.ts`

**Settings:**

- `src/settings/model.ts` — new `agentMode.*` settings tree (active
  backend, per-backend slices, sticky model/mode/effort, MCP servers)
- `src/settings/v2/components/AgentSettings.tsx` — dedicated Agents tab
- `src/settings/v2/components/AdvancedSettings.tsx` — frame-log toggle
- `src/settings/v2/SettingsMainV2.tsx` — tab registration
- `src/components/agent/BinaryPathSetting.tsx` — generic binary-path
  picker shared by backends

**Build / runtime shims (needed because the SDK assumes Node, but
Obsidian runs in Electron's renderer):**

- `nodeModuleShim.mjs`
- `scripts/patchRendererUnsafeUnref.js`
- `esbuild.config.mjs`
- `__mocks__/@anthropic-ai/`
- `typings/global.d.ts`

---

## Reading order at a glance

1. **Group 1 — Contract** (must be first)
2. **Group 2 — Transport: ACP + SDK side-by-side**
3. **Group 3 — Backend catalog**
4. **Group 4 — Session core + adapters**
5. **Group 5 — Chat UI**
6. **Group 6 — Plan/permission vertical**
7. **Group 7 — Host seam**

After Group 1 the order is mostly negotiable — Groups 2/3/4 can flex
based on what you want to validate first. But Group 6 should always come
after 2/4/5, and Group 7 should always come last.
