# Quick Chat → Agent Integration — Technical Design

> **Status:** Draft, 2026-05-20.
> **Companion to:** the Model Management Redesign technical plan (shared separately as a handoff artifact for the implementing agent; product UX spec is `designdocs/MODEL_MANAGEMENT_REDESIGN.md`).
> **Scope owner:** Follow-up workstream after the model management redesign ships. The model management plan creates a Quick Chat **skeleton** sub-tab in the Agent panel — this doc owns the rest: runtime routing, chat-input → backend resolution, and binding LangChain chat into the new chat view as a first-class agent backend.

---

## 0. Why this doc exists

The latest Copilot design (`copilot-model-settings/project/screens/final.jsx`) introduces a fourth agent sub-tab called **Quick chat** sitting alongside OpenCode, Claude Code, and Codex. Conceptually, what used to be "chain mode" — single-turn LangChain calls made directly from the chat input — is being elevated into an _agent backend_ in its own right, so that:

- **All four backends share the same shape** (status card · default model · default reasoning effort · in-session model picker).
- **The chat input model picker becomes the source of routing.** When the user selects a model, the active agent backend is whichever one curated that model into its picker. Pick a Quick-Chat-curated model → LangChain chat fires. Pick an OpenCode-curated model → OpenCode session fires. The user no longer needs to flip a separate "chain mode vs agent mode" switch.
- **The "new chat view" (the redesigned chat UI shipping alongside the agent work)** treats Quick Chat the same way it treats every other backend: opens a session, streams messages, surfaces tool calls, renders attachments. The view doesn't branch on "is this LangChain?" — it just talks to the backend through the existing `BackendDescriptor` contract.

The model management redesign plan deliberately stops short of this work because it touches the chat session pipeline, the chat input model picker, the new chat view, and the legacy ChatModelManager call sites — too many surfaces for one ship. This doc plans that follow-up cleanly.

---

## 1. Goals & Non-goals

### Goals

1. **Quick Chat is a real agent backend.** It implements the existing `BackendDescriptor` interface (`src/agentMode/backends/types.ts`) so the chat view, session manager, and `[Use this backend]` button treat it identically to OpenCode et al.
2. **Chat input model picker = routing decision.** Selecting a model in the chat input resolves to one specific backend; the plugin starts a session in that backend with that model.
3. **The new chat view renders Quick Chat sessions** using the same primitives it uses for OpenCode/Claude Code/Codex sessions.
4. **Per-backend curation works for Quick Chat.** The user picks which chat-capable BYOK models surface in Quick Chat's in-session picker (already wired in the model management M6 skeleton; this doc activates the runtime path).
5. **Migration is silent.** Users with a saved `defaultModelKey` (pre-redesign) keep that same model as their Quick Chat default — already arranged by the model management plan's migration step 7.

### Non-goals

- **No new LLM features.** This is wiring, not capability work. Streaming, tool use, vision — all use the existing LangChain pipeline.
- **No changes to OpenCode/Claude Code/Codex backends.** They're untouched.
- **No new settings tabs.** Quick Chat is a sub-tab inside the existing Agent panel.
- **No legacy chat view changes.** This doc assumes the new chat view is the target. (If a legacy view still ships during transition, Quick Chat falls back to legacy LangChain invocation on that path — see §6.5.)

---

## 2. Conceptual model

### 2.1 Routing — "which backend owns this model right now?"

Today the chat input picker reads from `activeModels` and hands the selection to `ChatModelManager`, which builds a LangChain client. Agent mode is a separate path: a toggle + a per-backend default model.

After this work:

```
Chat input picker
    │
    ▼  user picks "Claude Sonnet 4.5"
    │
    ▼
ChatRoutingService.resolveBackend(modelKey)
    │
    ▼
┌────────────────────────────────────────────────────────┐
│ For each backend in priority order:                    │
│   if backend.picker.includes(modelKey): return backend │
│                                                        │
│ Priority order: active backend → quickChat →           │
│   opencode → claude → codex                            │
└────────────────────────────────────────────────────────┘
    │
    ▼
ChatSessionManager.openSession(backend, modelKey)
```

**Why this priority order:** It prefers what the user explicitly set as active, then defaults to Quick Chat (the safest, mobile-capable choice), then falls back through the agent backends. A model the user has only added to Quick Chat's picker but is _currently_ active in OpenCode → if the active backend (OpenCode) doesn't have it, we fall to the next backend that does.

**A model can appear in multiple backends' pickers** (e.g., Claude Sonnet 4.5 in both OpenCode's picker AND Quick Chat's picker). The priority rule above resolves the ambiguity deterministically.

### 2.2 Why Quick Chat is conceptually an "agent" with N=1 turn

A Quick Chat "session" is a single-turn LangChain call. Modeling it as an agent (rather than keeping the legacy direct path) buys:

- One unified session-state model in the chat view (message stream, citations, tool results).
- One unified persistence path (`ChatPersistenceManager` doesn't branch on mode).
- One unified `[Use this backend]` semantics (cosmetic — Quick Chat is always "available" since it has no install step).
- The ability to upgrade Quick Chat to multi-turn tool use later without invalidating session storage.

The single-turn vs multi-turn distinction stays inside the backend implementation — callers don't care.

---

## 3. Architecture

### 3.1 The Quick Chat backend

New file: `src/agentMode/backends/quickChat/QuickChatBackend.ts`. Implements `BackendDescriptor`:

```typescript
const quickChatBackend: BackendDescriptor = {
  id: "quickChat",
  displayName: "Quick chat",
  isAvailable: () => true, // always available
  detectInstall: async () => ({ installed: true, version: "in-process" }),
  // No install / auth ceremony.
  startSession: (opts) => new QuickChatSession(opts),
  // Reads settings.agentMode.backends.quickChat
  getSettingsSchema: () => quickChatSettingsSchema,
};
```

### 3.2 `QuickChatSession` — wraps existing ChatModelManager

```typescript
class QuickChatSession implements BackendSession {
  constructor(private opts: SessionOptions) {}

  async send(message: UserMessage): Promise<AsyncIterable<SessionEvent>> {
    const provider = await ProviderRegistry.get(this.opts.providerId);
    const entry = ModelRegistry.get(this.opts.providerId, this.opts.modelId);
    const config = buildLangChainConfig(provider, entry, getGlobalDefaults());
    const chain = ChatModelManager.getInstance().buildChain(config);

    // Stream tokens out as standard SessionEvent[]:
    //   { kind: "message-start" } → { kind: "token", text } * N → { kind: "message-end" }
    yield * adaptLangChainStream(chain.stream(this.opts.history, message));
  }

  async close() {
    /* no-op; nothing to release */
  }
}
```

`adaptLangChainStream` is a new small helper that maps LangChain's stream events to the chat view's `SessionEvent` schema (already defined for OpenCode et al).

### 3.3 `ChatRoutingService`

New file: `src/services/ChatRoutingService.ts`. The single arbiter for "which backend owns this model right now":

```typescript
class ChatRoutingService {
  /** Used by the chat input picker to populate its dropdown.
   *  Returns the union of every backend's curated picker, with an
   *  origin tag so the UI can group / decorate. */
  listAllPickableModels(): Array<{ entry: RegistryEntry; backendId: BackendId }>;

  /** Used by the chat send button to resolve which backend will handle. */
  resolveBackend(providerId: ProviderId, modelId: string): BackendId | null;

  /** Used by the agent settings UI to render the per-backend picker. */
  listPickerForBackend(backendId: BackendId): RegistryEntry[];
}
```

`resolveBackend` follows §2.1's priority order. Returns `null` if the model isn't curated into any backend's picker (this should not happen under normal usage since the chat input only shows pickable models, but defensive code returns null → UI shows "configure this model in a backend first").

### 3.4 Sequence — sending a chat message

```
User
 │  picks model in chat input  (model key: "anthropic:claude-sonnet-4-5")
 │
 ▼
ChatInputComponent
 │  reads ChatRoutingService.resolveBackend(...) → "quickChat"
 │  reads agentMode.backends.quickChat (default model + effort)
 │
 ▼
ChatSessionManager.openSession({ backendId: "quickChat", modelKey, history })
 │  delegates to quickChatBackend.startSession({ ... })
 │
 ▼
QuickChatSession.send(userMessage)
 │  resolves provider creds via ProviderRegistry
 │  buildLangChainConfig(...) → ChatModelManager.buildChain(...)
 │  streams events back to the new chat view
 │
 ▼
ChatView renders the stream (same path as OpenCode et al)
```

---

## 4. Data model additions

The model management plan already declared the structural slot for Quick Chat's settings:

```typescript
agentMode.backends.quickChat: {
  defaultModel?: ModelSelection | null;          // { baseModelId, effort }
  modelEnabledOverrides?: Record<string, boolean>;
}
```

This doc adds **no new top-level settings**. All routing logic is derived from existing data:

- Provider creds: `settings.providers`
- Registered models: `settings.registry`
- Active backend: `settings.agentMode.activeBackend`
- Per-backend pickers: `settings.agentMode.backends.<id>.modelEnabledOverrides`

---

## 5. Migration

The model management plan's migration step 7 already seeds `agentMode.backends.quickChat.defaultModel` from the user's pre-redesign `defaultModelKey`. **This doc adds one more migration concern that runs as part of the Quick Chat workstream (not v0→v2 — a new v2→v3 migration, since the v0→v2 migration ships before this doc's implementation):**

### Migration v2 → v3 (Quick Chat enablement)

For each registry entry with `capabilities.includes("chat")` that is NOT currently in any backend's `modelEnabledOverrides`:

- Insert into `agentMode.backends.quickChat.modelEnabledOverrides[<providerId>:<modelId>] = true`.

Why: pre-existing users have models they've used for chat. Without this seeding, Quick Chat's picker would be empty on first launch after the follow-up ships, and selecting a model in the chat input would resolve to `null` (no backend owns it).

The migration is idempotent (no-op once the entry exists). It runs once and stamps `settingsVersion = 3`.

---

## 6. UI surface — what changes vs the skeleton in M6

The model management plan's M6 already ships:

- Quick Chat sub-tab (last, after OpenCode/Claude Code/Codex).
- Default model dropdown sourced from `ModelRegistry.list({ capability: "chat" })`.
- Default reasoning effort chip group.
- `BackendModelPicker` writing to `agentMode.backends.quickChat.modelEnabledOverrides`.

What this doc adds:

### 6.1 Quick Chat status card

The skeleton shows a generic "Active — runs in the plugin" status. This doc replaces that with the real status card:

- **Status badge:** `✓ Active backend` (when `activeBackend === "quickChat"`) or `○ Configured, not active`.
- **Subtitle:** "Runs in-process. No install or auth required."
- **Actions:** `[Use this backend]` only. No `[Reinstall]` / `[Browse…]` / `[Sign in]`.

### 6.2 Chat input model picker

Reads `ChatRoutingService.listAllPickableModels()`. Groups by backend (Quick Chat / OpenCode / Claude Code / Codex sections). Renders model name + provider muted + a tiny backend glyph.

When the user picks a model:

1. Resolve backend via `ChatRoutingService.resolveBackend(...)`.
2. If different from current active session's backend: prompt confirmation (_"Start a new chat with Quick Chat?"_) **only if the current session has messages**. Otherwise switch silently.
3. Start a session via `ChatSessionManager.openSession(...)`.

### 6.3 New chat view binding

The new chat view's session-open path receives a `BackendId` like any other. No conditional branches for "is this LangChain?" — the view talks to whatever session is returned by `ChatSessionManager.openSession(...)`.

What this means concretely: `src/components/chat-components/*` files that currently dispatch differently for chain mode vs agent mode are reduced to one path. The dispatch happens earlier (at `ChatRoutingService.resolveBackend`).

### 6.4 Legacy chat view (transition)

If the old chat view is still being shipped during this transition: keep its current chain-mode path unchanged. Quick Chat backend's `QuickChatSession` is a no-op consumer for the legacy view — the legacy view continues to call `ChatModelManager` directly. The new chat view is the only consumer of the Quick Chat backend session API.

This separation lets us ship the Quick Chat backend incrementally without forcing the legacy view to rewrite.

### 6.5 Picker source-of-truth chip

Optional polish: when a model is selected, the chat input shows a tiny `via Quick chat` / `via OpenCode` etc. tag next to the model name — so power users can see at a glance which backend is being used. Hidden by default; toggle in Advanced.

---

## 7. Implementation milestones

Each milestone independently verifiable; depends on the model management plan's M2 + M6 being shipped (so the schema and the skeleton UI are in place).

### Q1 — `ChatRoutingService` + routing data model

**Goal:** Pure-logic routing service with full unit tests; no UI changes.

- `src/services/ChatRoutingService.ts` per §3.3.
- Wires reads from existing `ModelRegistry` + `agentMode.backends.*`.
- Unit tests covering: priority order (active → quickChat → opencode → claude → codex), model in multiple pickers, model in no pickers (returns null), empty-picker edge cases.

**Verify:** `npm run test -- ChatRoutingService` green; no UI regressions.

### Q2 — Quick Chat backend implementation

**Goal:** `QuickChatBackend` + `QuickChatSession` working end-to-end; can be exercised via a dev command.

- `src/agentMode/backends/quickChat/QuickChatBackend.ts`.
- `src/agentMode/backends/quickChat/QuickChatSession.ts`.
- `src/agentMode/backends/quickChat/adaptLangChainStream.ts` — converts LangChain stream events to `SessionEvent`.
- Registered in `src/agentMode/backends/registry.ts` alongside opencode/claude/codex.
- Dev command `Copilot: Test Quick Chat backend` — opens a session, sends "hello", logs the streamed events to console.
- Unit tests for `adaptLangChainStream` (token / message-end / error event shapes).

**Verify:** Dev command produces a complete event stream; tests green.

### Q3 — Settings v2→v3 migration

**Goal:** Seed Quick Chat picker for existing chat-capable models. Stamp `settingsVersion = 3`.

- `src/settings/migrations/v2-to-v3.ts` per §5.
- `src/settings/migrations/__tests__/v2-to-v3.test.ts` — fixtures.
- Run only when `settingsVersion === 2`; idempotent.

**Verify:** Test vault with a v2 schema → after load, Quick Chat picker is populated with all chat-capable registered models.

### Q4 — Chat input model picker integration

**Goal:** Chat input picker reads from `ChatRoutingService`; sending a message resolves a backend.

- `src/components/chat-components/ChatInputModelPicker.tsx` — refactor to read `ChatRoutingService.listAllPickableModels()`.
- `src/state/ChatUIState.ts` — route through `ChatRoutingService.resolveBackend(...)` on send.
- New session prompt-on-backend-switch logic.
- Tests: picker renders grouped by backend; send dispatches to correct backend per fixtures.

**Verify:** Open chat → pick a Quick-Chat-only model → send → response streams via QuickChatBackend (verifiable via dev console).

### Q5 — Quick Chat status card + new chat view binding

**Goal:** Real status card (replacing skeleton); new chat view uses Quick Chat session API end-to-end.

- `src/settings/v3/components/backends/QuickChatPanel.tsx` — replace skeleton status with §6.1.
- New chat view session-open path → `ChatSessionManager.openSession({ backendId: "quickChat", ... })` for Quick-Chat-resolved messages.
- E2E test: open chat → pick a model → send → message renders in new chat view; provenance shows "Quick chat".

**Verify:** Full user flow works without touching the OpenCode/Claude Code/Codex panels.

### Q6 — Legacy view fallback + cleanup

**Goal:** Old chat view (if still present) continues to work via legacy `ChatModelManager` path. Quick Chat-only consumers go through the backend. Cleanup dead code paths.

- Audit chain-mode vs agent-mode branches in chat components; collapse where the new view is the only consumer.
- Update docs (`docs/llm-providers.md`, `docs/agent-mode-and-tools.md`).
- Final lint/format/test/build clean.

**Verify:** Old + new chat views both work; no orphan code from the chain-mode → backend collapse.

---

## 8. Risks

| Risk                                                                                                                  | Mitigation                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model is in multiple backends' pickers, and the priority rule surprises users                                       | Surface the resolved backend via the optional `via <backend>` chip in §6.5; add a one-time toast in Q4 explaining the priority rule.               |
| Quick Chat's single-turn assumption breaks when LangChain agents (tool use) are wired in later                        | `QuickChatSession.send` already returns an async iterable of events — tool calls just become additional event types. Schema is forward-compatible. |
| v2→v3 migration runs after a user has already manually curated Quick Chat's picker (deselected models in M6 skeleton) | Migration only **inserts** missing entries; never overwrites `false` overrides. Idempotent.                                                        |
| New chat view + legacy chat view diverge during transition                                                            | Document the routing contract explicitly; have Q6 audit branch points.                                                                             |
| LangChain stream events don't map cleanly to `SessionEvent` schema                                                    | Q2 has `adaptLangChainStream` as a unit-tested adapter; add new event types if needed (the schema is open).                                        |

---

## 9. Out-of-scope reminders

- Model management redesign itself (BYOK tab, Configure Provider dialog, catalog service, schema migration v0→v2) → see the Model Management Redesign technical plan (handoff artifact shared separately) and `designdocs/MODEL_MANAGEMENT_REDESIGN.md` for the product UX spec.
- New chat view design → owned by chat workstream.
- Embeddings tab → owned by model management redesign M3.
- Skill/MCP integration in chat → separate workstream.

---

## Appendix — File inventory (Q1–Q6)

| File                                                                   | Milestone |
| ---------------------------------------------------------------------- | --------- |
| `src/services/ChatRoutingService.ts`                                   | Q1        |
| `src/services/__tests__/ChatRoutingService.test.ts`                    | Q1        |
| `src/agentMode/backends/quickChat/QuickChatBackend.ts`                 | Q2        |
| `src/agentMode/backends/quickChat/QuickChatSession.ts`                 | Q2        |
| `src/agentMode/backends/quickChat/adaptLangChainStream.ts` + tests     | Q2        |
| `src/agentMode/backends/registry.ts` (extended)                        | Q2        |
| `src/settings/migrations/v2-to-v3.ts` + tests                          | Q3        |
| `src/components/chat-components/ChatInputModelPicker.tsx` (refactored) | Q4        |
| `src/state/ChatUIState.ts` (refactored)                                | Q4        |
| `src/settings/v3/components/backends/QuickChatPanel.tsx` (real status) | Q5        |
| New chat view session-open path (refactored)                           | Q5        |
| Legacy chat view audit + docs                                          | Q6        |
