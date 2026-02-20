# ACP Integration Design (Final)

Status: Final draft for implementation
Date: 2026-02-19

## 1. Goal

Add ACP-based agents (Claude Code, Codex, OpenCode first) as a first-class interaction paradigm in Copilot.

Core direction:

- ACP is a parallel runtime path.
- Existing LangChain-based chat modes remain intact.
- Long-term architecture is optimized for ACP as the primary agent path.

## 2. Final Decisions

1. Use `InteractionMode` (`llm` vs `agent`) instead of adding `ChainType.ACP`.
2. Keep ACP runtime isolated from LangChain model/tool/memory/envelope stacks.
3. Support file read/write + permission in agent mode.
4. OpenCode model switching is required when ACP session model capabilities are available.

## 3. What ACP Changes (and What It Does Not)

### 3.1 Bypassed in `agent` mode

- `ChainManager` / `ChainRunner` request pipeline
- `ChatModelManager` and provider model selection
- `ContextManager` L1-L5 envelope construction
- `LayerToMessagesConverter`
- LangChain memory sync (`MemoryManager`, `updateChatMemory`)
- LangChain-native `ToolRegistry` tool planning/calling
- `getAIResponse()` in `src/langchainStream.ts`

### 3.2 Reused in `agent` mode

- Chat shell UI and message list containers
- `MessageRepository` for display storage
- `ChatUIState` subscription model
- `ChatManager` as orchestration hub (with an ACP-specific send path)
- Existing settings infrastructure

## 4. Runtime Architecture

### 4.1 Interaction Mode

Add top-level interaction mode in `src/aiParams.ts`:

```ts
type InteractionMode = "llm" | "agent";
```

- `llm` mode: current Copilot behavior unchanged.
- `agent` mode: ACP pipeline and controls.

### 4.2 ACP Runtime Modules

Create a dedicated ACP namespace (`src/acp/`):

- `src/acp/ports/agent-client.port.ts` — IAgentClient interface (main contract)
- `src/acp/adapters/acp.adapter.ts` — process spawn, ACP handshake, ndJSON stream, session update routing, permission queue
- `src/acp/adapters/terminal-manager.ts` — handles ACP terminal callbacks: `terminal/create`, `terminal/output`, `terminal/kill`, `terminal/wait_for_exit`
- `src/acp/types/*` — domain types (AgentConfig, SessionUpdate, PromptContent, etc.)
- `src/acp/session/ACPManager.ts` — adapter lifecycle, agent switching, config resolution
- `src/acp/context/AcpPromptAssembler.ts` — builds ACP prompt content from user input + attached context
- `src/acp/updates/AcpUpdateReducer.ts` — routes session update notifications to message state
- `src/acp/components/*` — agent selector, model/mode selectors, tool/permission/terminal renderers

Design rules:

- ACP modules must not depend on LangChain runtime components.
- All ACP protocol details isolated in `adapters/` layer; domain and UI layers use port interfaces only.

### 4.3 ChatManager Parallel Path

Keep existing `sendMessage()` unchanged (LLM mode).
Add `sendAgentMessage()` for ACP mode:

1. Create/store user message (display text).
2. Build ACP prompt content via `AcpPromptAssembler`.
3. Delegate to ACP manager for session/prompt streaming.

## 5. Context Strategy in Agent Mode

ACP agents manage their own context windows and tools. Copilot should only provide turn-scoped context.

Agent-mode prompt policy:

- Include current user message.
- Include current-turn attached context only (notes/web selections/images).
- Do not build or inject L2 cumulative context library.
- Do not inject Copilot L4 conversation strip.
- Do not force Copilot system prompt by default.

Attached context conversion (handled by `AcpPromptAssembler`):

- @mentioned notes → ACP `Resource` blocks if agent supports `embeddedContext` capability, otherwise embedded as text in the prompt.
- Images → ACP image content blocks if agent supports `image` capability.
- Web selections → embedded as text content blocks.

Optional advanced setting (off by default):

- "Prepend Copilot custom system instructions in agent mode"

This avoids context duplication and keeps prompt behavior agent-native.

## 6. File Read/Write and Permission Model

This section reflects observed ACP integration patterns and the final Copilot design requirements.

### 6.1 Finding: Typical ACP File Operation Patterns

Observed in common ACP client flows:

- During ACP initialize, clients may advertise:
  - `fs.readTextFile = false`
  - `fs.writeTextFile = false`
- and still provide rich editing UX through:
  - agent `tool_call` / `tool_call_update` events (including diff content),
  - ACP `session/request_permission`,
  - permission UI actions mapped back to ACP permission responses.

Meaning:

- file editing permission flow is often agent-tool-based, not strictly dependent on ACP `fs/*` callbacks.

### 6.2 Copilot requirement and final design

Copilot agent mode must support file read/write with permission controls.

We support this through two channels:

1. Agent-tool permission channel (MVP required)

- Handle and render `tool_call`/`tool_call_update` diffs and statuses.
- Handle `session/request_permission` with explicit approve/reject UI.
- Default secure posture: no auto-allow by default.

2. ACP fs callback channel (compatibility extension)

- Implement real `fs/readTextFile` and `fs/writeTextFile` handlers against Obsidian vault APIs.
- Gate writes behind the same explicit permission workflow.
- Keep capability flags accurate per actual implementation.

Rationale:

- Channel 1 matches real behavior of target agents and is required immediately.
- Channel 2 improves compatibility for agents that use ACP fs APIs directly.

### 6.3 Tool Call Architecture in Agent Mode

In `agent` mode, there are two tool lanes:

1. ACP-native agent tools (primary lane)

- Agent executes tools internally.
- Agent emits `tool_call` / `tool_call_update`.
- Copilot renders tool blocks and permission state.

2. Agent Skills (context-based, agent-executed)

- Skills are **markdown files and scripts** in a user-configured folder, similar to Claude Code's skill system.
- Copilot surfaces skill files to the agent as context. The **agent** reads and executes them — Copilot does not run tools client-side.
- Progressive disclosure: not all skills are dumped at once. Relevant skills are surfaced based on conversation context.

#### 6.3.1 Agent Skills Design

**What a skill is:**

- A `.md` file containing instructions, templates, or domain knowledge.
- Optionally accompanied by scripts (shell, python, etc.) that the agent can execute via its own tool system.
- Organized in a configurable skills folder within the vault (e.g., `copilot-skills/`).

**Example skill structure:**

```
copilot-skills/
├── vault-search.md         # How to use miyo CLI/MCP for hybrid vault search
├── web-search.md           # Self-hosted web search endpoint and usage
├── youtube-transcription.md # Self-hosted YouTube transcription service
├── code-review.md          # Instructions for how to review code in this project
├── commit-conventions.md   # Commit message format and rules
├── vault-organization.md   # How notes are structured in this vault
├── scripts/
│   ├── run-tests.sh        # Test runner the agent can invoke
│   └── lint-check.sh       # Linting script
└── templates/
    └── meeting-note.md     # Template the agent can use when creating notes
```

**Example: vault-search.md (miyo integration)**

```markdown
# Vault Search

Use miyo for hybrid (semantic + keyword) search over this vault.

## CLI

miyo search "<query>" --limit 10

## MCP

miyo is also available as an MCP server for structured tool access.
```

**Example: web-search.md (self-hosted service)**

```markdown
# Web Search

Self-hosted web search via Firecrawl.

Endpoint: http://localhost:3002/v1/search
Method: POST
Body: {"query": "...", "limit": 5}
Returns: JSON array of {title, url, content}
```

This pattern covers all local tools and self-hosted services uniformly:

- **miyo** for vault hybrid search (CLI or MCP — agent chooses)
- **Self-hosted Firecrawl** for web search
- **Self-hosted Supadata** for YouTube transcription
- Any future local service the user runs

Copilot never needs to bridge or proxy these. The agent calls them directly.

**How skills reach the agent:**

- Since working directory = vault root, the agent has filesystem access to skill files directly.
- Copilot tells the agent about the skills folder location in the prompt context.
- Copilot can optionally list available skill filenames so the agent knows what's there.
- The agent decides which skills to read and follow — full agency stays with the agent.

**Progressive disclosure strategy:**

- Level 1: Always include a skill index (list of filenames + one-line descriptions) in the prompt.
- Level 2: Include full content of skills tagged as "always active" (e.g., project conventions).
- Level 3: Agent reads additional skill files on demand via its own file read tools.

**Skill management UI:**

- Settings: configure skills folder path.
- Skills browser: list discovered skills, toggle "always active" flag per skill.
- No client-side execution — Copilot never runs skill scripts. The agent does.

**Key principle:**

- Skills are context, not tools. Copilot provides them. The agent acts on them.
- This keeps the ACP path clean — no client-side tool execution, no LangChain coupling.
- Analogous to how Claude Code reads CLAUDE.md files for project-specific instructions.

## 7. Agent and Session State

### 7.1 Agent presets

Built-in defaults:

- Claude Code
- Codex
- OpenCode

Each preset is user-editable:

- `id`, `displayName`, `command`, `args`, `env`.

Do not hardcode a single arg style across versions.

- OpenCode commonly uses an `acp` subcommand in examples.
- Some agents may use flags such as `--acp`.
- Presets are defaults, not strict assumptions.

### 7.2 Capabilities

Track capabilities from ACP initialize/new session:

- prompt capabilities (image/resource)
- session capabilities (mode/model/list/load/resume/fork if available)

All UI controls are capability-gated.

### 7.3 OpenCode model switching

Requirement implementation:

- Use ACP session models from `newSession` / loaded session data.
- Show model selector when multiple models are exposed.
- Switch with `unstable_setSessionModel`.
- Use optimistic UI update with rollback on error.

Important protocol note:

- `current_mode_update` is mode-specific.
- Do not rely on it as model-change confirmation.

### 7.4 Error handling and reconnection

Agent process errors are surfaced explicitly in the chat UI. No silent recovery.

**Error categories:**

- **Spawn failure** (command not found, permission denied): Show error with setup guidance. Detect via exit code 127, `ENOENT`.
- **Agent crash** (unexpected process exit): Show error in chat. Session state → "disconnected".
- **Protocol error** (ACP JSON-RPC errors): Show error message from agent. Session remains connected if process alive.
- **Silent failure** (agent returns empty response): Detect via zero session updates + `end_turn`. Check stderr for API key / auth hints.

**Reconnection strategy:**

- No automatic reconnection. Agent processes are stateful — blindly restarting loses session context.
- User-initiated: "Restart Agent" action kills process, re-spawns, creates new session.
- If agent supports `loadSession`: offer "Restart and Reload" to re-spawn + reload previous session history.
- Display clear connection status indicator (connected / busy / disconnected / error) in ChatControls.

## 8. UI Behavior

### 8.1 ChatControls

When `interactionMode === "llm"`:

- keep existing chain/model controls.

When `interactionMode === "agent"`:

- show agent selector.
- show mode selector when ACP modes available.
- show model selector when ACP models available.
- show session/connection status indicator.
- hide Copilot Plus LangChain tool toggles and command injection controls.
- show skills folder indicator (configured/not configured, skill count).

### 8.2 Message rendering in agent mode

Render ACP updates as first-class content:

- assistant text stream (`agent_message_chunk`)
- thought stream (`agent_thought_chunk`)
- tool call blocks (`tool_call`, `tool_call_update`)
- permission controls (`request_permission`)
- terminal output blocks
- plan blocks

Do not reuse legacy marker-based agent rendering as the primary ACP path.

Additionally show skill context metadata when skills are active:

- skills folder path indicator
- list of "always active" skills included in prompt context

## 9. Message Flow

### 9.1 LLM mode (unchanged)

Existing path remains as-is:

- `Chat` -> `ChatUIState` -> `ChatManager.sendMessage()` -> LangChain flow.

### 9.2 Agent mode

New path:

1. `Chat` checks `interactionMode === "agent"`.
2. `ChatManager.sendAgentMessage()` stores user message and builds ACP prompt content.
3. ACP manager ensures process/session and sends `session/prompt`.
4. Session updates stream back into message state.
5. Cancel maps to ACP `session/cancel`.

## 10. Settings Additions

Extend `CopilotSettings` with ACP section:

- `interactionModeDefault` (optional)
- `acpDefaultAgentId`
- `acpAgents: ACPAgentConfig[]`
- `acpAutoAllowPermissions` (default false)
- `acpSkillsFolderPath` (default `"copilot-skills"`, vault-relative)
- optional ACP diagnostics/logging toggles

## 11. Implementation Plan

### Phase 1: Core ACP lane

**Goal**: End-to-end text streaming with a single agent (Claude Code).

**New files:**
| File | Ported from reference | Description |
|---|---|---|
| `src/acp/ports/agent-client.port.ts` | `domain/ports/agent-client.port.ts` | IAgentClient interface |
| `src/acp/types/agentConfig.ts` | `domain/models/agent-config.ts` | AgentConfig, BaseAgentSettings |
| `src/acp/types/sessionUpdate.ts` | `domain/models/session-update.ts` | SessionUpdate union type |
| `src/acp/types/promptContent.ts` | `domain/models/prompt-content.ts` | PromptContent types |
| `src/acp/types/sessionState.ts` | `domain/models/chat-session.ts` | Mode/model state types |
| `src/acp/types/agentError.ts` | `domain/models/agent-error.ts` | Error types |
| `src/acp/adapters/acp.adapter.ts` | `adapters/acp/acp.adapter.ts` | Core ACP adapter (~1200 lines) |
| `src/acp/adapters/acp-type-converter.ts` | `adapters/acp/acp-type-converter.ts` | Domain ↔ SDK types |
| `src/acp/utils/shellUtils.ts` | `shared/shell-utils.ts` | Login shell wrapping |
| `src/acp/utils/errorUtils.ts` | `shared/acp-error-utils.ts` | Error parsing |
| `src/acp/session/ACPManager.ts` | new | Adapter lifecycle singleton |
| `src/acp/components/AgentSelector.tsx` | new | Agent picker dropdown |

**Modified files:**
| File | Change |
|---|---|
| `src/aiParams.ts` | Add `InteractionMode` type + Jotai atoms |
| `src/core/ChatManager.ts` | Add `sendAgentMessage()` method |
| `src/components/Chat.tsx` | Branch `handleSendMessage` on interaction mode |
| `src/components/chat-components/ChatControls.tsx` | Add mode toggle + agent selector |
| `src/settings/model.ts` | Add ACP settings fields |
| `package.json` | Add `@agentclientprotocol/sdk` dependency |

**Workload**: Largest phase. ~15 new files, ~5 modified files. The ACP adapter is the heaviest piece (~1200 lines ported from reference, adapted for Copilot patterns). Shell utils and type definitions are mostly direct ports. ACPManager and ChatManager integration are new code.

**Exit criteria**: Select Claude Code in agent mode → type message → see streaming text response in chat.

---

### Phase 2: Permissions + tool call rendering

**Goal**: Full tool call UX — diffs, terminal output, permission prompts.

**New files:**
| File | Ported from reference | Description |
|---|---|---|
| `src/acp/adapters/terminal-manager.ts` | `shared/terminal-manager.ts` | Terminal lifecycle + output buffering |
| `src/acp/components/ToolCallBlock.tsx` | new (reference has `ToolCallRenderer.tsx`) | Tool call status, kind, title, locations |
| `src/acp/components/DiffViewer.tsx` | new (reference has `DiffBlock.tsx`) | File diff rendering |
| `src/acp/components/TerminalOutput.tsx` | new (reference has `TerminalBlock.tsx`) | Terminal command output |
| `src/acp/components/PermissionRequestUI.tsx` | new (reference has `PermissionRequestSection.tsx`) | Approve/deny inline buttons |
| `src/acp/components/PlanBlock.tsx` | new (reference has `PlanBlock.tsx`) | Execution plan task list |
| `src/acp/updates/AcpUpdateReducer.ts` | new | Routes session updates to message content |

**Modified files:**
| File | Change |
|---|---|
| `src/components/chat-components/ChatMessages.tsx` | Detect and render ACP content types |
| `src/settings/model.ts` | Add `acpAutoAllowPermissions` |

**Workload**: Medium-heavy. ~7 new component files. TerminalManager is substantial (~500 lines from reference). UI components are mostly new but follow patterns from reference plugin. AcpUpdateReducer is new routing logic.

**Exit criteria**: Agent performs file edit → see diff in chat → permission prompt appears → approve → agent continues. Terminal commands show output blocks.

---

### Phase 3: Mode/model controls + settings

**Goal**: Full agent configuration, OpenCode model switching, mode selection.

**New files:**
| File | Description |
|---|---|
| `src/acp/components/AgentModelSelector.tsx` | Model dropdown populated from ACP session models |
| `src/acp/components/AgentModeSelector.tsx` | Mode dropdown populated from ACP session modes |
| `src/acp/components/AgentSettingsTab.tsx` | Full settings UI for agent configuration |

**Modified files:**
| File | Change |
|---|---|
| `src/acp/adapters/acp.adapter.ts` | Add `setSessionMode()`, `setSessionModel()` calls |
| `src/components/chat-components/ChatControls.tsx` | Wire model/mode selectors, connection status |
| `src/settings/model.ts` | Add built-in agent presets, custom agent support |

**Workload**: Medium. 3 new UI components, moderate adapter additions. Settings tab is the largest piece — per-agent command/args/env/apikey editing. Model/mode selectors are small but need optimistic UI + rollback.

**Exit criteria**: Select OpenCode → see model dropdown → switch to minimax-2.5 → agent confirms model change. Edit Claude Code command path in settings → reconnect works.

---

### Phase 4: Agent Skills

**Goal**: Skills folder discovery, index generation, always-active injection, skills browser.

**New files:**
| File | Description |
|---|---|
| `src/acp/context/AcpPromptAssembler.ts` | Builds prompt content: user text + mentions + skill index + active skills |
| `src/acp/context/skillDiscovery.ts` | Scans skills folder, extracts index (filename + first-line description) |
| `src/acp/components/SkillsBrowser.tsx` | List skills, toggle "always active" per skill |

**Modified files:**
| File | Change |
|---|---|
| `src/acp/session/ACPManager.ts` | Inject skill context into prompts |
| `src/settings/model.ts` | Add `acpSkillsFolderPath` setting |

**Workload**: Medium-light. Skill discovery is straightforward filesystem scanning. AcpPromptAssembler assembles the prompt with skill index + active skill content. Browser UI is a simple list with toggles.

**Exit criteria**: Configure `copilot-skills/` folder → skills appear in browser → mark `vault-search.md` as always-active → send message → agent sees skill index + vault-search.md content in prompt → agent uses miyo to search.

---

### Phase 5: ACP fs callback compatibility

**Goal**: Real vault read/write via ACP `fs/*` callbacks for agents that use them.

**New files:**
| File | Ported from reference | Description |
|---|---|---|
| `src/acp/adapters/vault-adapter.ts` | `adapters/obsidian/vault.adapter.ts` | Bridges ACP fs to Obsidian vault API |

**Modified files:**
| File | Change |
|---|---|
| `src/acp/adapters/acp.adapter.ts` | Enable `fs.readTextFile`/`fs.writeTextFile` capabilities, wire to vault adapter |

**Workload**: Light. Single adapter file. Read is simple vault file read. Write needs permission prompt before executing (reuse permission UI from Phase 2).

**Exit criteria**: Agent using ACP fs API reads vault file → gets content. Agent writes file → permission prompt → approve → file written to vault.

---

### Phase 6: Session lifecycle enhancements

**Goal**: Session persistence, load/resume, session history browser.

**New files:**
| File | Description |
|---|---|
| `src/acp/components/SessionHistoryModal.tsx` | Session list + load/resume actions |

**Modified files:**
| File | Change |
|---|---|
| `src/acp/adapters/acp.adapter.ts` | Add `listSessions()`, `loadSession()`, `resumeSession()`, `forkSession()` |
| `src/acp/session/ACPManager.ts` | Session metadata persistence, capability-gated session operations |
| `src/settings/model.ts` | Add saved session metadata storage |

**Workload**: Medium. Session list/load requires adapter additions and UI. All session features are capability-gated — only show UI if agent supports them. Fork is unstable and lowest priority within this phase.

**Exit criteria**: Close and reopen Obsidian → switch to agent mode → "Load Session" shows previous sessions → select one → conversation history replays → can continue conversation.

## 12. Risks and Mitigations

- ACP unstable methods: isolate protocol details in adapter layer.
- Process lifecycle errors: explicit reconnect and error surfacing (see 7.4).
- Permission safety: default deny/explicit user action.
- Context bloat: strict per-turn context assembly only.
- UI complexity: mode-gated controls and capability-based rendering.

## 13. Future Decisions (Post-MVP)

The following items are intentionally deferred from MVP and should be revisited in later phases:

1. `@` command behavior in agent mode

- Decide whether `@vault/@websearch/@composer/@memory` remain plain text only, or trigger skill-hint injection behavior.

2. Skill file schema contract

- Decide whether skills require frontmatter metadata (`name`, `description`, `alwaysActive`, `tags`) vs free-form markdown.

3. Progressive disclosure algorithm

- Define how skill relevance is selected (keyword, tags, manual pinning, hybrid scoring).

4. Skill prompt budget limits

- Set hard caps for skill index size and total always-active skill content injected per turn.

5. Tool integration boundary

- Confirm whether agent mode stays context-only for skills, or eventually allows selective client-side Copilot tool execution.

6. Script safety model

- Define Copilot-level safeguards for skill scripts (trusted folders, warnings, policy prompts) in addition to agent permission flow.

7. Skills scope model

- Decide global vault-wide skills vs project/profile-specific skill sets.

8. Skills folder constraints

- Decide vault-relative only skills folders vs external/absolute path support.

## 14. Acceptance Criteria

- Agent mode can run Claude Code, Codex, OpenCode.
- OpenCode model switching works when the agent exposes session models.
- File operations are permission-controlled and visible in chat.
- LLM modes are behaviorally unchanged.
- ACP mode avoids LangChain context/model/tool/memory pipelines.
- ACP mode never invokes LangChain autonomous tool planning/execution loops.
- Agent Skills (md files + scripts) are surfaced as context; agent reads and executes them, not Copilot.
