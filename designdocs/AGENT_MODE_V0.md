# Agent Mode for Obsidian Copilot — ACP-based harness

> Design doc. Save target: `designdocs/AGENT_MODE.md` (alongside `MESSAGE_ARCHITECTURE.md`). Keep this document as the source of truth while the feature is being built; delete or move it to "historical" after v1 ships.

## 1. Context

**Goal.** Give Copilot users access to an advanced, BYOK agent harness — skills, MCP, plan mode, multi-step tool use, permission gating — without making them install a CLI. The chosen vehicle is [`opencode`](https://github.com/sst/opencode), which already implements all of this. Long-term, the plugin should be able to plug into Claude Code (via [`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp)) and Codex (via [`cola-io/codex-acp`](https://github.com/cola-io/codex-acp)) so users aren't locked to one provider. opencode is **the BYOK backend**; the other two are future backends for users who have their own Claude/OpenAI subscriptions.

**Why not embed opencode as a JS library.** opencode is distributed as a Bun-compiled platform binary. `@opencode-ai/sdk`'s `createOpencodeServer()` does not run opencode in-process — it literally `cross-spawn`s the `opencode` CLI (`packages/sdk/js/src/server.ts:35`). The TypeScript source has no library entry point: all session/agent state is gated behind an HTTP or ACP server. It uses Bun-specific APIs (`Bun.which`, `Bun.file`, `Bun.stdin`) and pulls in native deps (`@lydell/node-pty`, tree-sitter WASM, `@parcel/watcher`, SQLite via drizzle, `@opentui/core`). Not bundleable through esbuild.

**Why ACP (Agent Client Protocol).** opencode ships an ACP mode (`opencode acp`, see `packages/opencode/src/acp/`). ACP is stdio + newline-delimited JSON-RPC 2.0, defined at [agentclientprotocol.com](https://agentclientprotocol.com/protocol/overview). By speaking ACP, Copilot becomes a generic ACP client and opencode is just one interchangeable backend — the same seam Zed uses for its "external agents" ([`zed.dev/docs/ai/external-agents`](https://zed.dev/docs/ai/external-agents)).

**Why not a new `ChainRunner`.** The existing `BaseChainRunner` interface (`src/LLMProviders/chainRunner/BaseChainRunner.ts:7-19`) is a LangChain-era abstraction modelled as a one-shot `run(userMessage, abortController, ...) → Promise<string>`. Agent Mode is a **long-lived, stateful ACP session** that handles many turns, streams tool-call / plan / permission events between turns, and needs to keep running in the background while the user switches away. Forcing this shape into a callback-based "run once" interface is naming debt we don't need to take on. Existing chains (chat, copilot-plus, autonomous) keep their runners untouched — this is Agent-Mode-only.

**Decisions taken** (from clarifying questions):

- v1 ship: **opencode backend only**, but architect the ACP client layer so Claude Code / Codex / custom slot in later.
- Agent Mode is built around a new `AgentSession` abstraction, coordinated by `AgentSessionManager`. **It does not extend `BaseChainRunner`.** It does not disturb the existing `AutonomousAgentChainRunner` or other LangChain-era chains.
- Agents run with **vault folder as cwd**, but the plugin advertises `clientCapabilities.fs.{readTextFile,writeTextFile}=true` and routes those RPCs through `app.vault.adapter.read`/`write`. Permission requests surface through a Copilot UI modal.
- **Multiple concurrent chats.** Users can start a new Agent Mode chat while a previous one keeps executing in the background, and detach / reattach the UI without killing the session. Implemented via an in-panel tab strip over a pool of `AgentSession`s multiplexed on a single opencode subprocess.
- **Desktop only.** ACP is stdio JSON-RPC; Obsidian mobile cannot spawn subprocesses. Feature is hidden on mobile.

---

## 2. Milestones

Agent Mode ships incrementally. Each milestone is independently shippable (behind a feature flag until M3 lands). A user who only gets M1+M2 has a working single-session Agent Mode; M3 adds background concurrency; M4+ polish the experience.

| #       | Milestone                     | Outcome                                                                                                                   |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **M0**  | Scaffolding & feature gate    | `ChainType.AGENT_MODE`, settings slice, mobile hiding, `AgentSessionManager` stub. No user-visible behavior.              |
| **M1**  | opencode binary install UX    | Two-click download/verify/install flow; reinstall & uninstall in settings.                                                |
| **M2**  | Single-session Agent Mode MVP | One `AgentSession` end-to-end: prompt → ACP → streaming tool calls → vault reads/writes → permission modal.               |
| **M3**  | Multi-session architecture    | `AgentSessionManager` pool of N sessions on one backend; in-panel tab strip; detach/reattach while sessions keep running. |
| **M4**  | MCP / Skills / BYOK polish    | MCP server config + passthrough; skills verified; BYOK bridged from existing Copilot keys; plan-mode UI.                  |
| **M5**  | Robustness & debuggability    | Crash recovery, diagnostic bundle download, verbose logs, JSONL replay, secret redaction.                                 |
| **M6+** | Future backends & features    | Claude Code / Codex backends; obsidian-copilot-mcp; image inputs; terminal/\* interception; session persistence.          |

Each section below is tagged with the milestone it belongs to (e.g. `[M2]`) so the doc doubles as an execution checklist.

---

## 3. High-level architecture

```
Copilot chat (Agent Mode)
  └─ AgentSessionManager                (plugin-scoped coordinator)
       ├─ backend: AcpBackendProcess     (lazily spawned; shared by all sessions)
       │    ├─ Transport: stdio to child_process.spawn(backend.command, backend.args, { env })
       │    ├─ acp: ClientSideConnection (from @agentclientprotocol/sdk)
       │    ├─ vaultClient: VaultClient  (implements ACP Client interface)
       │    │   • sessionUpdate        → route by acpSessionId → AgentSession.updateBus
       │    │   • requestPermission    → AcpPermissionModal (UI)
       │    │   • readTextFile         → app.vault.adapter.read
       │    │   • writeTextFile        → app.vault.adapter.write
       │    │   • terminal/*           → v1: unset capability (agent uses internal shell)
       │    └─ OpencodeBackend          (spawn descriptor: command/args/env)
       └─ sessions: Map<internalId, AgentSession>
            • one AgentSession per chat tab
            • each owns its own MessageRepository, AbortController, event bus
            • created via backend.acp.newSession() → cheap RPC on existing connection

Binary provisioning:
  OpencodeBinaryManager: download / SHA256 verify / install / pin / update

Existing chains (chat / copilot-plus / autonomous) are **unchanged**. They continue
to use BaseChainRunner + ChainManager singletons. Agent Mode bypasses that path.
```

### 3.1 Core abstractions

- **`AgentSessionManager` [M0 stub, M2 single-session, M3 multi-session]** — plugin-scoped coordinator. Owns the single `AcpBackendProcess`, a `Map<internalId, AgentSession>`, and the `activeSessionId` that drives the tab strip. Lazy-spawns the backend on the first `createSession()`.
- **`AcpBackendProcess` [M2]** — wraps `ClientSideConnection` + `AcpProcessManager` + `VaultClient`. Implements `sessionUpdate` by demultiplexing on `params.sessionId` (the ACP session id from opencode) into the right `AgentSession`'s update bus. Survives across sessions; torn down only on plugin unload.
- **`AgentSession` [M2]** — the per-chat unit. Owns its own `MessageRepository`, `AbortController`, status (`idle | running | awaiting_permission | error | closed`), and an event bus. Exposes `sendPrompt(content) → Promise<StopReason>`, `cancel()`, `dispose()`, `subscribe(listener)`. In M2 there is one; in M3 there are N.
- **`ChatUIState` adapter [M3]** — today `ChatUIState` is backed by one `ChatManager` and is a plugin-wide singleton (`src/state/ChatUIState.ts:16-24`). In M3 it gains a small adapter so it can be backed by either a `ChatManager` (legacy chains) or an `AgentSession` (Agent Mode). Public API (`subscribe`, `getMessages`, `sendMessage`, …) stays identical so `<Chat />` doesn't need to know.

### 3.2 Module layout (new files)

| File                                                           | Milestone        | Responsibility                                                                                              |
| -------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/LLMProviders/agentMode/AgentSessionManager.ts`            | M0 stub → M3     | Plugin-scoped coordinator. Owns the backend and the session pool.                                           |
| `src/LLMProviders/agentMode/AgentSession.ts`                   | M2               | Per-chat session: `MessageRepository`, `AbortController`, streaming bus, `sendPrompt`, `cancel`, `dispose`. |
| `src/LLMProviders/agentMode/AcpBackendProcess.ts`              | M2               | Wraps `ClientSideConnection`. Multiplexes `session/update` by `acpSessionId` (M3).                          |
| `src/LLMProviders/agentMode/AcpProcessManager.ts`              | M2               | `child_process.spawn`, ndJSON stream, stderr→logger, SIGTERM→SIGKILL.                                       |
| `src/LLMProviders/agentMode/VaultClient.ts`                    | M2               | Implements ACP `Client` via Obsidian APIs.                                                                  |
| `src/LLMProviders/agentMode/backends/types.ts`                 | M2               | `AcpBackend` interface so Claude Code / Codex slot in later.                                                |
| `src/LLMProviders/agentMode/backends/OpencodeBackend.ts`       | M2               | Builds `{ command, args, env }`; packs BYOK + MCP + skills into `OPENCODE_CONFIG_CONTENT`.                  |
| `src/LLMProviders/agentMode/backends/OpencodeBinaryManager.ts` | M1               | Platform-aware download/verify/install from GitHub releases.                                                |
| `src/components/agent/AgentTabStrip.tsx`                       | M3               | In-panel tab strip (`[sess1●] [sess2] [+]`) rendered above `<Chat />` when in Agent Mode.                   |
| `src/components/agent/AcpPermissionModal.tsx`                  | M2               | Obsidian `Modal` rendering `session/request_permission` with diff preview for edit/write tools.             |
| `src/components/agent/AgentModeStatus.tsx`                     | M2               | Inline status UI ("Downloading 32%", "Ready", "Starting", "Error — retry").                                 |
| `src/settings/v2/components/AgentModeSettings.tsx`             | M0 shell → M1/M4 | Enable toggle, BYOK keys, model picker, MCP/skills config, binary version + reinstall.                      |

Agent Mode deliberately does **not** add a `ChainType.AGENT_MODE` case to `getChainRunner()` in `chainManager.ts`. It bypasses that switch entirely.

### 3.3 Modified files

- `src/chainFactory.ts` [M0] — add `ChainType.AGENT_MODE`.
- `src/constants.ts` [M0] — `AGENT_MODE` constant, pinned opencode version, download URL template, SHA256 manifest URL.
- `src/settings/model.ts` [M0] — add `agentMode` slice with migration.
- `src/settings/v2/components/BasicSettings.tsx` [M0] — mount new settings section.
- `src/main.ts` [M0/M3] — instantiate `agentSessionManager` on load, call `shutdown()` on unload, hide Agent Mode on `Platform.isMobile`.
- `src/components/CopilotView.tsx:174-181` [M2/M3] — when chain type is AGENT_MODE, render `<AgentTabStrip />` (M3) above `<Chat />` and pass the active session's `ChatUIState`; otherwise keep `plugin.chatUIState`.
- `src/components/Chat.tsx:89,397-416` [M3] — decouple `AbortController` from view unmount for Agent Mode. Today unmount calls `abortControllerRef.current?.abort(ABORT_REASON.UNMOUNT)`. Agent Mode opts out: sessions own their own controllers and must survive unmount.
- `src/state/ChatUIState.ts:16-24` [M3] — small adapter so it can be backed by either a `ChatManager` or an `AgentSession`.

### 3.4 Reused components (no changes needed)

- `src/core/MessageRepository.ts` — reused verbatim, one instance per `AgentSession`.
- `src/core/ChatManager.ts:38-90` — the `projectMessageRepos: Map<projectId, MessageRepository>` pattern is the template we mirror for `sessionMessageRepos`.
- `src/core/ChatPersistenceManager.ts`, `src/core/ContextManager.ts` — unchanged; used by each `AgentSession`.
- Existing chat streaming UI components — render `agent_message_chunk`/`agent_thought_chunk` identically to today's LLM streaming.
- `src/encryptionService.ts` — for BYOK secrets in `OPENCODE_CONFIG_CONTENT`.

### 3.5 Dependencies

Runtime: `@agentclientprotocol/sdk` (^0.20). No other new runtime deps — `child_process`, `fs`, `crypto`, `https` are Node built-ins available in Electron.

---

## 4. End-to-end flows

### 4.1 Single-session flow [M2]

#### 4.1.1 Startup

1. User enables **Agent Mode** in settings and enters BYOK API keys (Anthropic/OpenAI/etc.).
2. `OpencodeBinaryManager.isInstalled()` checks `<plugin-data>/opencode/<pinned-version>/bin/opencode`.
3. If missing: open install modal (§5). If present: proceed.
4. `AgentSessionManager.createSession()` is called (either on first user message or when the user clicks the chat input). Lazy-starts `AcpBackendProcess`:

   ```ts
   {
     command: "<plugin-data>/opencode/1.3.17/bin/opencode",
     args:    ["acp", "--cwd", app.vault.adapter.getBasePath()],
     env: {
       ...process.env,
       OPENCODE_CONFIG_CONTENT: JSON.stringify({
         provider: {
           anthropic: { options: { apiKey: settings.byok.anthropic } },
           openai:    { options: { apiKey: settings.byok.openai    } },
           // ...
         },
         agent: { /* from settings.agentMode.agents */ },
         mcp:   { /* from settings.agentMode.mcpServers */ },
         // skill directories are auto-discovered from .claude/, .agents/, skills/
         // relative to cwd (vault root) — nothing extra needed
       }),
     },
   }
   ```

5. `AcpProcessManager` spawns with `{ stdio: ["pipe","pipe","pipe"] }`. stdin/stdout are piped into `acp.ndJsonStream`; stderr is captured and routed to Copilot's logger (`logInfo`/`logError`).
6. `AcpBackendProcess.initialize`:
   ```ts
   await conn.initialize({
     protocolVersion: acp.PROTOCOL_VERSION,
     clientCapabilities: {
       fs: { readTextFile: true, writeTextFile: true },
       // terminal intentionally omitted in v1
     },
   });
   ```
7. `backend.acp.newSession` returns an `acpSessionId`; the `AgentSession` is constructed with a fresh `MessageRepository`, `AbortController`, and event bus:
   ```ts
   const { sessionId: acpSessionId } = await conn.newSession({
     cwd: app.vault.adapter.getBasePath(),
     mcpServers: settings.agentMode.mcpServers ?? [],
   });
   ```
8. `AgentModeStatus` flips to **Ready**.

#### 4.1.2 Prompt turn

1. User sends a message. The chat component routes it to `agentSession.sendPrompt(content)` (not to a chain runner). The session assembles prompt content blocks (text + `@`-mention resources) and calls:
   ```ts
   const { stopReason } = await conn.prompt({ sessionId: this.acpSessionId, prompt: [...] });
   ```
2. opencode streams `session/update` notifications. `AcpBackendProcess.sessionUpdate` looks up the target `AgentSession` by `acpSessionId` and emits on its bus:
   - `agent_message_chunk` → append to the current assistant message via this session's `MessageRepository`.
   - `agent_thought_chunk` → render as a collapsed thinking block (reusing `ThinkBlockStreamer`).
   - `tool_call` → create a structured tool-call part in the message (status = pending).
   - `tool_call_update` → transition status, attach content (diffs, stdout, search results).
   - `plan` → render as a plan list block.
3. During a turn, opencode may call the client back:
   - **`fs/read_text_file`** → `VaultClient.readTextFile` resolves the path relative to vault root; rejects paths outside vault; returns content via `app.vault.adapter.read` (honors `line`/`limit`).
   - **`fs/write_text_file`** → `app.vault.adapter.write`; Obsidian's file change events fire so open editors update without restart.
   - **`session/request_permission`** → `VaultClient.requestPermission` opens `AcpPermissionModal` with tool name, diff preview, and option buttons derived from `options[]`. User's choice returns `{ outcome: { outcome: "selected", optionId } }` (or `"cancelled"`).
4. `sendPrompt()` resolves with `stopReason` (`end_turn` | `max_tokens` | `max_turn_requests` | `refusal` | `cancelled`). The `AgentSession` finalises the assistant message and flips status back to `idle`.

#### 4.1.3 Plan mode, skills, MCP

- **Plan mode.** When opencode decides to plan first, it emits `plan` session-updates before any tool calls. Copilot renders these as checkable items and lets the user approve the plan before execution (mediated by the same `requestPermission` modal — opencode asks for approval before transitioning to execution). [M4]
- **Skills.** opencode auto-discovers from `.claude/`, `.agents/`, and `skills/` relative to cwd (= vault root). Users drop a `SKILL.md` into `.claude/` inside their vault; opencode picks it up. An advanced setting exposes an additional skill path in `OPENCODE_CONFIG_CONTENT` for globals. [M4]
- **MCP.** Settings include an "MCP servers" editor (array of `{ name, command, args, env, transport }`). Passed through to `newSession.mcpServers` (Zed-style ACP field) and mirrored into `OPENCODE_CONFIG_CONTENT.mcp` so opencode's config loader finds them. [M4]

#### 4.1.4 Shutdown

- On plugin unload or user toggling Agent Mode off: `AgentSessionManager.shutdown()` calls `cancel()` then `dispose()` on every session, then `backend.shutdown()` closes the stdio stream. `AcpProcessManager` sends SIGTERM, waits 3s, then SIGKILL.
- On Obsidian quit: `onunload` fires the same path. Worst case if that fails, opencode detects parent stdin close and self-exits.

### 4.2 Multi-session flow [M3]

M3 promotes `AgentSession` from singleton to N-of and introduces the tab strip.

#### 4.2.1 UI

```
┌──────────────────────────────┐
│ [sess1●] [sess2] [+]         │  ← AgentTabStrip (new in M3)
├──────────────────────────────┤
│ messages for active sess...  │  ← <Chat /> bound to
│                              │    activeSession.chatUIState
└──────────────────────────────┘
```

- One Copilot `ItemView`, one workspace leaf — we do **not** open one Obsidian leaf per chat. The tab strip lives inside the panel.
- `CopilotView.renderView` branches on chain type: in Agent Mode it renders `<AgentTabStrip />` above `<Chat />` and passes `agentSessionManager.activeSession.chatUIState` as the `chatUIState` prop. For every other chain, it passes `plugin.chatUIState` exactly as today — no breakage.
- ● = the session has a turn in flight. Right-click a tab → **End** disposes the session; **Rename** lets the user label it.

#### 4.2.2 Behavior

- **Spawn a second session.** User clicks `+` while sess1 is mid-turn. `createSession()` calls `backend.acp.newSession()` again — a cheap RPC on the existing connection, no second subprocess. A new `AgentSession` with its own `MessageRepository` is added to the pool; active tab switches to sess2.
- **Sess1 keeps streaming.** sess1's tab still shows ● and its `MessageRepository` keeps accumulating chunks even though no UI is subscribed to its bus.
- **Event demuxing.** `AcpBackendProcess.sessionUpdate(params)` reads `params.sessionId` and routes to the right `AgentSession` via `acpSessionToInternal: Map<acpSessionId, AgentSession>`. No cross-talk.
- **Reattach.** User clicks sess1 → `setActiveSession("sess1")` → `<Chat />` re-renders against `sess1.chatUIState` → `getMessages()` returns the full accumulated history. If a turn is still in flight, a `pendingChunkBuffer` on the session feeds the streaming placeholder on the first render tick.
- **Close the leaf entirely.** Closing the Copilot view does **not** dispose sessions — they live on `AgentSessionManager` (plugin-scoped). Reopening the panel re-subscribes to whichever session was active.
- **Cancel one session.** `session.cancel()` sends `session/cancel` over ACP with that session's `acpSessionId`; its `AbortController.abort()` rejects its pending `sendPrompt()` promise; status → `idle`. Other sessions are unaffected.
- **Explicit end.** Right-click tab → End → `closeSession(id)`: cancels if in-flight, removes from map, notifies tab strip. Backend process stays up for other sessions.

#### 4.2.3 Per-project isolation

Sessions tag themselves with `projectId` at creation (from `plugin.projectManager.getCurrentProjectId()`). The tab strip filters to sessions belonging to the current project. This reuses the existing pattern in `ChatManager.projectMessageRepos` (`src/core/ChatManager.ts:38-90`): rather than nesting `Map<projectId, Map<sessionId, …>>` we flatten into `Map<sessionId, AgentSession>` where each session knows its `projectId`.

---

## 5. Painless opencode install UX [M1]

The install flow must be a two-click experience with clear progress, verification, and recovery. No terminal, no manual PATH edits.

### 5.1 Flow

1. **User enables Agent Mode** → Copilot shows `AgentModeStatus` as "Setup required".
2. Click **"Install opencode"** → modal appears:
   ```
   ┌──────────────────────────────────────────┐
   │ Install opencode (BYOK Agent backend)    │
   │                                          │
   │ opencode runs locally on your machine.   │
   │ We'll download the official binary from  │
   │ github.com/sst/opencode/releases.        │
   │                                          │
   │ Platform: darwin-arm64                   │
   │ Version:  v1.3.17 (pinned)               │
   │ Size:     ~62 MB                         │
   │ SHA256:   <fingerprint>                  │
   │                                          │
   │ Destination:                             │
   │   <vault>/.obsidian/plugins/copilot/     │
   │     data/opencode/1.3.17/                │
   │                                          │
   │ [ Cancel ]      [ Download & install ]   │
   └──────────────────────────────────────────┘
   ```
3. On confirm: streaming progress bar; on completion, SHA256 verify; extract to final path; mark installed.
4. Status flips to "Ready". Agent Mode is usable (M2 onward).

### 5.2 Platform resolution

Copy the resolver logic from opencode's own `bin/opencode` launcher:

- `process.platform` → `darwin` | `linux` | `windows`
- `process.arch` → `x64` | `arm64` | `arm`
- On linux: detect musl (check `/etc/alpine-release`, then `ldd --version`).
- On x64: detect avx2 (macOS: `sysctl hw.optional.avx2_0`; linux: `/proc/cpuinfo`; Windows: PowerShell `IsProcessorFeaturePresent(40)`).
- Build asset candidate list: `opencode-<platform>-<arch>[-baseline][-musl]` with fallback order matching opencode's launcher.

### 5.3 Download + verification

- Fetch release metadata from `https://api.github.com/repos/sst/opencode/releases/tags/v<version>`.
- Compute expected asset name via the resolver.
- Download the tarball/zip using Node `https` with progress events.
- Verify SHA256 against `.sha256` file from the same release (or a manifest shipped with the plugin for fully air-gapped installs).
- Extract to `<plugin-data>/opencode/<version>/bin/opencode`.
- `chmod 755` the binary on unix.

### 5.4 Recovery and edge cases

| Situation                                   | Behavior                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network failure mid-download                | Resume via `Range` header if possible; otherwise restart. Clear partial file.                                                                                                                                                     |
| SHA256 mismatch                             | Delete, show error, offer retry. Log the expected vs actual.                                                                                                                                                                      |
| Disk out of space                           | Cancel, show friendly error with required MB.                                                                                                                                                                                     |
| GitHub rate limited                         | Surface the 60/hour API limit; suggest setting `GITHUB_TOKEN` or retry later.                                                                                                                                                     |
| User is on corp proxy                       | Honor `HTTPS_PROXY` / `HTTP_PROXY` env vars (Node's `https` doesn't by default — use `https-proxy-agent` only if actually needed; alternative: surface "network blocked" error with copy-the-URL-and-download-manually fallback). |
| Binary already exists (re-install)          | Overwrite only if checksum differs, else no-op.                                                                                                                                                                                   |
| Plugin update pins a newer opencode version | Keep old version dir for rollback; install new version alongside; switch on success.                                                                                                                                              |
| Windows SmartScreen / macOS Gatekeeper      | See §6.4 (stability caveats). Document the first-launch prompt in a help link from the install modal.                                                                                                                             |

### 5.5 Settings UI after install

- Shows installed version with "Check for update" (opt-in, so runs stay reproducible).
- "Reinstall" button (re-download + verify).
- "Uninstall" button (removes binary dir — does not touch BYOK keys or MCP config).
- Advanced: "Use custom opencode binary path" (points `OPENCODE_BIN_PATH` at a user-provided binary for developers/self-builders).

### 5.6 Why downloading is OK here

Obsidian plugins routinely download assets on first use — examples: dataloader/web-clipper extensions, local embedding model downloads in other plugins. Obsidian's plugin guidelines don't forbid it; what they forbid is shipping the binary inside the plugin tarball (which would blow up the release size × 6 platforms). Downloading on demand, with a clear progress UI and explicit user consent, is the accepted pattern.

---

## 6. Caveats — honest assessment

This section is the most important part of this doc. Going with a subprocess-based ACP architecture buys us a lot, but it comes with real costs. Be honest about them up front.

### 6.1 Functionality

| Area                                                   | Status            | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-step agentic reasoning                           | ✅ M2             | opencode's core strength; ACP streams every step.                                                                                                                                                                                                                                                                                                                                                                                      |
| Tool calling                                           | ✅ M2             | Full opencode tool registry: `bash`, `read`, `write`, `edit`, `multiedit`, `glob`, `grep`, `webfetch`, `websearch`, `lsp`, `task`, `question`, `plan_enter`/`plan_exit`, `skill`, etc.                                                                                                                                                                                                                                                 |
| Multiple concurrent chats                              | ✅ M3             | `AgentSessionManager` pool; each tab = one `AgentSession` multiplexed on one backend. Detach/reattach without cancelling.                                                                                                                                                                                                                                                                                                              |
| Skills                                                 | ✅ M4             | Auto-loaded from `.claude/`, `.agents/`, `skills/` relative to vault root.                                                                                                                                                                                                                                                                                                                                                             |
| MCP servers                                            | ✅ M4             | Passed through `newSession.mcpServers` and `OPENCODE_CONFIG_CONTENT.mcp`. Both stdio and HTTP MCP transports work.                                                                                                                                                                                                                                                                                                                     |
| Plan mode                                              | ✅ M4             | Streamed as `plan` session-updates; gated by `request_permission` before execution.                                                                                                                                                                                                                                                                                                                                                    |
| BYOK providers                                         | ✅ M2 / M4 polish | 20+ providers via Vercel AI SDK in opencode. User-supplied keys via `OPENCODE_CONFIG_CONTENT.provider`.                                                                                                                                                                                                                                                                                                                                |
| Image / multimodal inputs                              | ⚠️ M6+            | ACP supports image content blocks; need to wire Copilot's image-paste path into ACP `prompt` content. Ship text-only through v1.                                                                                                                                                                                                                                                                                                       |
| File read/write inside vault                           | ✅ M2             | Routed through Vault API (see §4.1.2). Obsidian file events fire correctly.                                                                                                                                                                                                                                                                                                                                                            |
| File ops **outside** the vault                         | ❌ by design      | `VaultClient` rejects out-of-vault paths. Consequence: opencode can't read `~/.zshrc` or the user's dotfiles. Acceptable for an Obsidian-scoped agent; document it.                                                                                                                                                                                                                                                                    |
| Git tool (`git`)                                       | ⚠️                | opencode's bash-based git works only if the vault is a git repo. Surface this, don't try to fix.                                                                                                                                                                                                                                                                                                                                       |
| Shell (`bash` tool)                                    | ⚠️ risk           | opencode can run arbitrary shell via its internal `node-pty`. In v1 **we do not advertise terminal capability**, so the agent uses its _own_ internal PTY — bypassing our permission UI for bash. Mitigation: either (a) advertise `terminal/*` capability and intercept all shell calls (significant work; M6+), or (b) configure opencode in `OPENCODE_CONFIG_CONTENT` to disable the bash tool by default for extra-cautious users. |
| Live editor context (selection, active note)           | ✅ M2             | Resolved before `sendPrompt`; passed as resource/text blocks, same shape as today's chat.                                                                                                                                                                                                                                                                                                                                              |
| Obsidian-specific actions (open note, set tag, rename) | ❌ M6+            | opencode can't do these unless we expose them as an MCP server. Plan: ship a built-in "obsidian-mcp" stdio MCP server that Agent Mode starts automatically.                                                                                                                                                                                                                                                                            |
| Canvas / dataview / other plugin data                  | ❌ M6+            | Same story: expose via obsidian-mcp or a custom MCP built into Copilot.                                                                                                                                                                                                                                                                                                                                                                |

### 6.2 Capability

- **Model choice is opencode's, not Copilot's.** Copilot's existing LLM abstraction (LangChain) is bypassed entirely in Agent Mode. "Temperature" from the existing UI does not apply — opencode has its own model config. Dedicated Agent Mode settings section (planned M0/M4).
- **BYOK keys are duplicated.** Users who've already entered a key in Copilot's normal LLM settings must re-enter it in Agent Mode — unless we bridge them. Proposed: reuse the same encrypted store; populate `OPENCODE_CONFIG_CONTENT.provider` from Copilot's existing BYOK settings automatically. ✅ M4.
- **No streaming mid-tool-call for some providers.** Depends on the model — opencode passes through AI SDK streaming; Claude/GPT-5 stream fine, some local models don't.
- **Context window ≠ Copilot's.** opencode does its own context packing + compaction. Copilot's context-processing pipeline (embeddings, `@vault` retrieval, etc.) is _not_ used by Agent Mode unless we expose it as an MCP tool (M6+ as `obsidian-copilot-mcp`).
- **Rate limiting.** Copilot's existing `rateLimiter.ts` doesn't apply. opencode has its own. Users may see surprise bursts of requests.

### 6.3 Performance

- **Startup latency.** Cold spawn of opencode on macOS: ~200–500 ms for the process, plus ACP `initialize` + `newSession` roundtrip (~50–100 ms). Mitigation: spawn on plugin load if Agent Mode is the active chain, not on first message. Keep the backend alive across sessions.
- **Second session is cheap.** Thanks to the one-process-N-sessions model (M3), opening a new chat tab is just a `newSession` RPC (~10 ms) — no second spawn.
- **First-message latency is dominated by model, not transport.** ACP stdio is microseconds per message. The big number is the LLM API.
- **Memory.** opencode holds a SQLite DB, web-ui assets, tree-sitter parsers, node-pty, its own model client. Empirically ~150–300 MB RSS when idle, ~400–600 MB under active tool use. This cost is paid **once per vault**, not per chat — N concurrent sessions share one subprocess. Document it.
- **Disk.** Binary 40–90 MB per platform version. Plus opencode's `~/.opencode/` data dir (session DB, auth, logs). Allow users to configure data dir location.
- **Download time.** 62 MB on a 20 Mbps link ≈ 25s. Fine for first install; mitigate GitHub redirect latency.
- **Backend restart cost.** If opencode crashes mid-turn, in-flight turns across all sessions are lost but Copilot-side message history is intact. Auto-restart on next prompt (M5).
- **No warm cache across vaults.** Each vault = separate cwd = separate backend. If the user switches vaults, cold start again.

### 6.4 Stability

- **Subprocess crash.** opencode is not an Anthropic product; it's a young open-source project (sst/opencode, active development). Expect crashes, especially on edge-case provider responses.
- **Shared-backend blast radius (new in M3).** Because all sessions share one subprocess, an opencode crash drops every session at once. Mitigation (M5): `AgentSessionManager` catches the `exit` event, flips every session to `status:"error"`, auto-restarts the backend on the next user action, and offers a one-click "retry last turn" per session. Per-session `MessageRepository` history survives on the Copilot side.
- **Protocol version mismatch.** ACP is v0.x. Breaking protocol changes are possible. We pin both the opencode version _and_ the `@agentclientprotocol/sdk` version, and `initialize` negotiates `protocolVersion`. If negotiation fails, show a clear "incompatible opencode version — reinstall or update" error.
- **Orphaned subprocesses.** If Obsidian crashes hard before `onunload` runs, opencode can leak. Mitigations: (1) opencode detects stdin close and exits; (2) on startup, kill any `opencode` process whose cwd matches our vault (risky — could kill the user's own opencode CLI sessions; don't do this by default).
- **Windows Defender / SmartScreen.** opencode releases are currently unsigned. First launch on Windows triggers SmartScreen. Document clearly; consider re-signing ourselves in a future release (M6+).
- **macOS Gatekeeper / quarantine.** Binary downloaded via Node `https` is _not_ quarantined by default (no `com.apple.quarantine` xattr set by us). Should run cleanly. If users download manually via a browser, they'll hit a quarantine prompt — document the mitigation (`xattr -dr com.apple.quarantine <binary>`).
- **Antivirus false positives.** Bun-compiled binaries occasionally trip AV heuristics. Precedent from other Electron apps; document the workaround (whitelist the binary path).
- **Network-restricted environments.** Corp laptops may block `github.com` asset downloads. Fallback: "Use custom opencode binary path" setting so IT can pre-stage the binary.
- **Version drift.** If a user's opencode binary is too new for the pinned SDK, or vice versa, compatibility breaks. Mitigation: plugin only upgrades opencode when the plugin itself upgrades (opt-in "check for update" button). CI test against the pinned pair.
- **Concurrency with external opencode.** Only one opencode process per Obsidian instance per vault. If the user already has `opencode` running in a terminal on the same vault, results are undefined (they share a data dir). Document it; consider using a different data dir via `XDG_DATA_HOME` override.
- **File-event loops.** opencode writes to a file → Obsidian fires file-changed event → some other plugin reacts → writes back → opencode's watcher fires → infinite loop. Low probability but possible. Mitigation: opencode's `@parcel/watcher` is scoped to cwd; Copilot doesn't need to do anything specific.

### 6.5 Debuggability

- **Two-process debugging.** When things break, the bug could be in Copilot's ACP client, ACP transport, opencode's ACP server, opencode's session core, the AI SDK, or the LLM API. That's a long blame chain.
- **Logging plan.** [M5]
  - Copilot side: log every ACP request/response with a `sessionId` and sequence number to the existing `logInfo`/`logError` pipeline.
  - opencode side: capture stderr verbatim and pipe to Copilot's log file. Let users toggle "Verbose opencode logs" (sets `--log-level=debug`).
  - Include a **"Download diagnostic bundle"** button in settings: zips Copilot log + opencode stderr + opencode data dir manifest + plugin config (redacted secrets) for bug reports.
- **Replay.** [M5] ACP is JSON-RPC; we serialize every message to a `.jsonl` file during a turn for deterministic replay. Useful for repro on bug reports. Ship as a debug toggle.
- **No source maps for opencode.** The binary is compiled Bun output; stack traces from opencode errors are minimally useful. Users will have to file issues upstream at `sst/opencode` — document this in the error UI ("this error came from opencode, report at ...").
- **Tool-call transparency.** The `tool_call_update` stream is rich (includes tool input/output/diffs). Surface a "show raw tool call" disclosure in the chat UI so users can see what opencode actually did.
- **Session inspector.** A dev-mode panel showing backend PID, uptime, per-session status + last message — copy-paste friendly for bug reports.
- **Comparison to existing chain runners.** Copilot engineers already have intuition for debugging `AutonomousAgentChainRunner` — debugging Agent Mode requires learning opencode. Short "How to debug Agent Mode" internal doc as part of M5.

### 6.6 Security

- **Subprocess with API keys.** opencode receives BYOK API keys via env var. Env vars are visible in `ps auxe` to the same user. Acceptable on a single-user machine; mention it in the setup modal.
- **Permission default.** Default `requestPermission` answer is **deny**. User must explicitly approve each destructive tool use (with "Allow for this turn" and "Always allow this tool" options). No silent writes.
- **Sandbox-escape surface.** opencode's bash tool gives arbitrary shell to the model. This is the single biggest risk. Mitigations: (a) permission prompts always required for bash in v1; (b) users can disable bash entirely via `OPENCODE_CONFIG_CONTENT.tool.bash.disabled = true`; (c) roadmap item to advertise `terminal/*` capability and intercept bash through a confined runner (M6+).
- **Secret redaction in logs.** Ensure `OPENCODE_CONFIG_CONTENT` is never logged verbatim (it contains API keys). [M5]

### 6.7 Mobile

- **Agent Mode is fundamentally unavailable on mobile.** No subprocess = no ACP. Settings UI hides the toggle with an explainer. Existing Copilot chains continue to work on mobile.

### 6.8 Compared to the existing AutonomousAgentChainRunner

| Aspect            | AutonomousAgentChainRunner (today)                            | Agent Mode (new)                                          |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Core abstraction  | `ChainRunner.run(userMessage, abortController, …)` — one-shot | `AgentSession.sendPrompt(content)` — stateful, long-lived |
| Transport         | In-process LangChain                                          | stdio subprocess (shared)                                 |
| Concurrency       | One runner at a time                                          | N `AgentSession`s on one backend (M3)                     |
| Tool registry     | Copilot's ~6 tools                                            | opencode's ~43 tools                                      |
| Skills            | —                                                             | ✅ (M4)                                                   |
| MCP               | —                                                             | ✅ (M4)                                                   |
| Plan mode         | —                                                             | ✅ (M4)                                                   |
| Models            | Via Copilot's chatModelManager                                | Via opencode's AI SDK (independent config)                |
| Works offline     | ✅ (for local models)                                         | ✅ (opencode supports Ollama/LM Studio)                   |
| Mobile            | ✅                                                            | ❌                                                        |
| Fail modes        | Stack traces in Copilot                                       | Two-process debugging                                     |
| Binary install    | —                                                             | ~62 MB download on first use                              |
| Vault integration | Direct                                                        | Via `fs/*` bridge + optional obsidian-mcp                 |

Keep both. Agent Mode is strictly additive — existing chains are untouched by this work.

---

## 7. Risks we are explicitly accepting

1. **Binary distribution friction on Windows** (unsigned binaries, SmartScreen). Monitor support volume; invest in signing if it bites.
2. **opencode project maturity** — young project, potentially breaking releases. Pin versions. Contribute upstream for blockers.
3. **Two-process debuggability tax** — will bite on-call; invest in diagnostic bundle up front (M5).
4. **Shared-backend blast radius** — a single opencode crash drops all sessions at once. M5 mitigates with auto-restart + per-session retry, but the window between crash and recovery is real.
5. **No Obsidian-native actions in v1** — opencode can't open a note or set frontmatter. Expose via obsidian-mcp in M6+.

## 8. Verification plan

Grouped by milestone. Each milestone must pass its own tests before the next one starts.

### Unit

| Target                  | Milestone | Assertions                                                                                                                                                                       |
| ----------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpencodeBinaryManager` | M1        | Correct asset name per `{platform, arch, libc, avx2}`; SHA256 check; idempotent install; resume-on-partial behavior.                                                             |
| `AcpProcessManager`     | M2        | spawn / stdio wiring; graceful SIGTERM→SIGKILL shutdown; stderr routed to logger.                                                                                                |
| `AcpBackendProcess`     | M2 / M3   | `initialize` + `newSession` sequence; M3: `sessionUpdate` routes to the correct `AgentSession` by `acpSessionId`; disconnect flips all sessions to `error`.                      |
| `VaultClient`           | M2        | Path resolution; out-of-vault rejection; read/write roundtrip through `app.vault.adapter`; `line`/`limit` handling.                                                              |
| `AgentSession`          | M2 / M3   | Status transitions (idle → running → idle on end_turn); chunks appended to `MessageRepository`; `cancel()` aborts in-flight turn without disturbing others.                      |
| `AgentSessionManager`   | M3        | `createSession` / `closeSession` map invariants; single-backend spawn (only first `createSession` triggers spawn); `activeSessionId` transitions; per-project session filtering. |
| `ChatUIState` adapter   | M3        | Same `getMessages()` / `subscribe()` semantics whether backed by `ChatManager` or `AgentSession`.                                                                                |

### Manual E2E (desktop)

#### M1 — install

1. Enable Agent Mode → install modal appears → download + SHA256 verify → binary extracted + `chmod 755` applied.
2. SHA mismatch simulated → error + retry flow works.
3. Offline/airplane → friendly error with "use custom binary path" fallback.
4. Reinstall button re-downloads and replaces in-place.

#### M2 — single-session

1. "read README.md and summarize" → `fs/read_text_file` lands in `VaultClient`; agent streams summary.
2. "create Inbox/agent-test.md with three bullets" → permission modal → approve → file appears in Obsidian without restart.
3. "plan X, then execute" → plan block renders; permission to enter execution phase; executes.
4. Cancel mid-turn → `session/cancel` sent; process stays alive; next prompt works.
5. Plugin unload → subprocess exits (check `pgrep opencode`).
6. Open vault on mobile → Agent Mode hidden with explainer.
7. Offline (airplane mode) + local model configured → works.

#### M3 — multi-session

1. Start sess1 streaming a long summary. Click `+` → sess2 appears, sess1 still shows ● in the tab strip.
2. Send a prompt in sess2 → both tabs stream concurrently; ChunkA goes only to sess1's message list, ChunkB only to sess2's.
3. Switch to sess1 mid-stream → buffer flushes, UI catches up to latest chunks; switch back to sess2 → its stream is intact.
4. Close the Copilot leaf entirely while sess1 is still running. Reopen it → both tabs still present, sess1 history intact (check that chunks streamed while detached are visible).
5. Right-click sess2 → End → session removed; sess1 unaffected.
6. Kill the opencode process externally → all tabs flip to `error`; one-click retry rebuilds the backend and replays the last turn per session (M5; for M3 alone, just verify the error state renders).

#### M4 — MCP / skills / BYOK

1. Configure an MCP server → tools show up in opencode; agent can invoke across all sessions.
2. Drop a `SKILL.md` into `.claude/` → skill discovered by opencode.
3. Remove BYOK from Agent Mode settings, confirm it falls back to the existing Copilot-wide encrypted key.

### Regression (all milestones)

- Chat / Plus / Autonomous / Project chains unchanged.
- `npm run test`, `npm run lint`, `npm run format:check` clean.

## 9. Out of scope for v1 — M6+ future work

- Claude Code backend (via `@agentclientprotocol/claude-agent-acp`).
- Codex backend (via `cola-io/codex-acp` — also needs a patch to honor client fs capabilities).
- `obsidian-copilot-mcp`: built-in MCP server exposing Obsidian-native actions (open note, set frontmatter, dataview query, etc.).
- Image / multimodal prompt inputs.
- `terminal/*` capability with a confined runner (intercepts bash).
- Session persistence across Obsidian restarts (ACP `session/load`).
- Signed opencode binaries on Windows.
