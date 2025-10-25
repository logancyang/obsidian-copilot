# Context Engineering Revamp Plan

## Intent

Copilot’s current prompt construction glues every note, tag, folder, tool result, and chat history snippet directly into the latest user message before handing it to each `ChainRunner`. That approach prevents provider-side prefix caching, duplicates large documents on every turn, and makes it difficult to control token budgets deterministically. This plan translates the requirements from `~/Obsidian/main-vault-202306/Copilot - Context Engineering Revamp.md` into concrete engineering work for this repository while keeping ChainRunner interfaces, tool execution contracts, and markdown chat archives backward compatible.

## Design Goals (from the revamp spec)

- **Layered prefix** (L1–L5) ordered from most stable to most volatile so cacheable prefixes stay identical across turns.
- **Model-agnostic** baseline: OpenAI/Gemini implicit caching and Anthropic long-context guidance without bespoke adapters.
- **Provider-aware optimizations** kept optional: explicit Gemini caches, Anthropic `cache_control`, prefix hashing.
- **No contract changes** for `ChainRunner`, `AgentChainRunner`, or tool execution APIs.
- **Backward compatibility** with existing chat markdown exports and stored conversations.

## Current Implementation Findings

### 1. System prompt & memory (`src/settings/model.ts:452-503`)

- `getSystemPromptWithMemory()` prepends serialized user memory to the system prompt every turn, even when memory is empty, and then each chain runner injects that block at the top of the OpenAI-style `messages` array.
- No canonical renderer exists, so any change in spacing or punctuation breaks cacheability.

### 2. Context ingestion (`src/core/ContextManager.ts:31-162` & `src/contextProcessor.ts`)

- `ContextManager.processMessageContext()` resolves notes, folders, tags, URLs, selected text, and Dataview blocks, then concatenates everything after the user’s raw text before saving it as `processedText`.
- Context is permanently baked into each user message; there is no notion of pinned (L2) vs. turn (L3) data, no hashing, and no metadata describing what was added.
- Attachments that repeat across turns are re-parsed, bloating each request.

### 3. Prompt assembly in runners (`src/LLMProviders/chainRunner/*.ts`)

- `CopilotPlusChainRunner`, `AutonomousAgentChainRunner`, `LLMChainRunner`, `VaultQAChainRunner`, and `ProjectChainRunner` each re-assemble prompts by hand:
  - They prepend the (mutable) system message, append every entry from LangChain memory (text-only for standard chains, unstructured for Plus/Agent), and finally push the latest user message—already stuffed with context.
  - Conversation history ordering varies between runners; none produce a compact “conversation strip” with deterministic truncation.
  - Tool outputs (local search, write-to-file, etc.) live inside the user message blob, meaning they cannot be cached or reasoned about independently.

### 4. Persistence and compatibility

- `MessageRepository` (`src/core/MessageRepository.ts`) retains only `displayText` + `processedText`. There is no structured representation of context layers, previous turn context metadata, or tool outputs that would let us rebuild L1–L4 for older chats.
- Chat exports serialize the cooked `processedText`, so any new layering must continue to round-trip to the previous format when saving/loading markdown.

## Gap Summary

| Spec Expectation             | Current Reality                                                 | Impact                                            |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| Stable L1/L2 prefix          | L1 mutates when memory is empty vs. non-empty; L2 doesn’t exist | No cache hits, inconsistent instructions          |
| Distinct turn context (L3)   | All attachments fused into user message                         | Extra tokens, duplicated parsing work             |
| Conversation strip (L4)      | Entire LangChain history replayed verbatim                      | Token spikes, no deterministic truncation         |
| Model-agnostic caching hooks | None                                                            | Can’t exploit provider discounts or latency gains |

## Target Layered Prefix Model

| Layer                         | Source                                                                                      | Update trigger                                        | Rendering & caching notes                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **L1: System & Policies**     | `DEFAULT_SYSTEM_PROMPT`, user overrides, user memory snapshot                               | Only when system settings or saved memory change      | Canonical renderer strips timestamps, extra whitespace. Hash persisted per conversation for cache validation.                                                                                          |
| **L2: Previous Turn Context** | Context from all previous turns (notes, URLs, PDFs) that aren't in current turn             | Automatically updated: previous turn's L3 moves to L2 | **Auto-promotion**: Previous turn's context automatically moves here. Stable when user stops adding new context. Deduplicated by unique ID (note path, URL). Sorted by first appearance for stability. |
| **L3: Current Turn Context**  | Context attached to the **current** user message only (active note, newly added notes/URLs) | Every turn                                            | Only contains context from the latest turn. Empty if user doesn't add new context.                                                                                                                     |
| **L4: Conversation History**  | LangChain memory (raw messages without context)                                             | Each turn adds new Q/A pair                           | Past turns are stable. Only grows with new conversation turns.                                                                                                                                         |
| **L5: User Message**          | Raw user input                                                                              | Every turn                                            | Always last; remains the message body the UI shows.                                                                                                                                                    |

## Smart Context Promotion: L2 Auto-Population

### Key Insight

Instead of manual pinning, we automatically promote context from previous turns to L2. This creates a **naturally stable prefix** that mirrors user intent:

- **L3**: "What I just added this turn"
- **L2**: "What I added in previous turns"

### Example Conversation

```
Turn 1: User asks "Summarize this" with project-spec.md attached
  L1: System prompt
  L2: (empty)
  L3: <note_context>project-spec.md</note_context>
  L5: "Summarize this"

Turn 2: User asks "What's the API?" with api-docs.md attached
  L1: System prompt (stable ✅)
  L2: <note_context>project-spec.md</note_context> ← moved from Turn 1
  L3: <note_context>api-docs.md</note_context>
  L5: "What's the API?"

Turn 3: User asks "Explain that" (no new context)
  L1: System prompt (stable ✅)
  L2: <note_context>project-spec.md</note_context>
      <note_context>api-docs.md</note_context> ← STABLE! Cache hit!
  L3: (empty)
  L5: "Explain that"

Turn 4: User asks "Debug this" with error-log.md attached
  L1: System prompt (stable ✅)
  L2: <note_context>project-spec.md</note_context>
      <note_context>api-docs.md</note_context> ← Still stable!
  L3: <note_context>error-log.md</note_context>
  L5: "Debug this"
```

### Benefits

1. **Automatic cache optimization**: L1+L2 become stable after user stops adding context
2. **Respects user intent**: Current turn's context in L3, previous in L2
3. **No manual management**: No UI needed for pinning/unpinning
4. **Zero duplication**: Each note appears exactly once (either L2 or L3, never both)
5. **Stable ordering**: L2 sorted by first appearance (deterministic across turns)

### Deduplication Rules

1. **By unique identifier**:

   - Notes: Full file path (`note.path`)
   - URLs: Full URL string
   - Selected text: Source file path + line range
   - Dataview blocks: Source file path + query hash

2. **Priority**: If context appears in current turn (L3), it's removed from L2

   - User re-attaches previous note → moves from L2 back to L3

3. **Ordering**: L2 sorted by first appearance timestamp (stable)

### Implementation Strategy

1. **Build L2 from message history**:

   ```typescript
   // Collect all context from previous messages (not current)
   const previousMessages = messageRepo.getDisplayMessages().slice(0, -1);
   const l2Context = new Map(); // deduped by ID

   for (const msg of previousMessages) {
     if (msg.context?.notes) {
       for (const note of msg.context.notes) {
         if (!l2Context.has(note.path)) {
           l2Context.set(note.path, { note, firstSeen: msg.timestamp });
         }
       }
     }
     // Same for URLs, selected text, etc.
   }
   ```

2. **Build L3 from current message only**:

   ```typescript
   const currentContext = currentMessage.context;
   // Process only currentContext (active note + any new attachments)
   ```

3. **Deduplicate**: Remove L3 items from L2
   ```typescript
   const l3NoteIds = new Set(currentContext.notes.map((n) => n.path));
   const l2Filtered = [...l2Context.values()].filter((entry) => !l3NoteIds.has(entry.note.path));
   ```

## Architecture Proposal

### 1. PromptContextEngine (new service)

- Centralizes prompt assembly, replacing the current “context baked into message” workflow.
- Input: `PromptContextRequest` containing `chatId`, `currentMessageId`, user text, structured attachments, tool outputs, provider metadata, and token budget hints.
- Output: `PromptContextEnvelope` with `layers`, `llmMessages`, `renderedSegments`, cache hints, and back-compat `processedUserText` for persistence.
- Lives beside `ContextManager` so existing context extraction code can feed L3 buckets instead of directly mutating message text.

### 2. Layer builders

- **L2 Builder** (new): Collects context from all previous messages in the conversation, deduplicated by unique ID (note path, URL). Sorted by first appearance for stability. Automatically excludes anything in current turn's L3.
- **L3 TurnContextAssembler**: Reuses `ContextProcessor` to fetch latest note snapshots from **current message only**. Emits structured entries `{ id, type, sha256, content }` tagged as L3.
- **L4 History**: Provided by LangChain memory (`MessageRepository.getLLMMessages()`). Returns raw messages without context.
- **Renderer**: Deterministically serializes each layer. Ensures whitespace normalization so identical inputs yield byte-identical outputs.

### 3. Optional provider-aware hooks

- **Implicit caching** _(always-on)_: encode `layerHashes` on the `PromptContextEnvelope` and emit logging when OpenAI `usage.prompt_tokens_details.cached_tokens` > 0. This validates stability without coupling to provider SDKs.
- **Gemini explicit cache** _(feature flag)_: provide a `GeminiCacheManager` that stores `(cacheKey = chatId + L1Hash + L2Hash)` and TTL (default 3600s). Chain runners include `cached_content` when `L2` remains unchanged.
- **Anthropic cache_control** _(feature flag)_: when targeting Claude, allow `PromptContextEngine` to inject `cache_control` metadata fields on `system` entries after L2 boundaries (max 4 breakpoints).

### 4. Data persistence

- `MessageRepository` gains optional `contextEnvelope?: SerializedLayerRef` per message storing:
  - The L3 entries for that turn.
  - Pointers (`hash`, `version`) to the L1/L2/L4 snapshots in effect.
- Chat markdown exporter continues to write `processedText`, but we also include a hidden JSON frontmatter block (e.g., `<!-- copilot-context: {...} -->`) so future loads can reconstruct layers without reprocessing old notes. When the metadata is missing, we rebuild by treating the stored text as “legacy fully-inlined context” (compat mode).

### 5. Updated send/regenerate flow

1. `ChatManager.sendMessage()` still writes the user-visible text immediately.
2. Instead of calling `ContextManager.processMessageContext()` to mutate the message string, it now calls `PromptContextEngine.buildTurnContext()`:
   - `ContextManager` focuses on extracting artifacts (notes, tags, folders, URLs, selected text) and returns structured payloads.
   - The engine decides what belongs in L2 vs. L3, updates registries, and emits the final envelope.
3. `ChainManager` receives the envelope, asks the engine for `llmMessages` formatted for the active provider, and streams the result.
4. `MessageRepository` stores the envelope metadata + legacy `processedText` (for markdown exports) derived by concatenating layers in order, preserving today’s behavior for consumers that still read `getLLMMessages()`.

### 6. Conversation strip API

- Provide `PromptContextEngine.getConversationStrip()` so every runner stops duplicating history logic.
- Builder enforces:
  - Configurable summary strategy (`K` = 2 by default, summary budget 200–300 tokens).
  - Fallback to legacy “dump entire history” when compatibility mode is needed (e.g., during staged rollout).

## Integration Plan

1. **Foundations (Feature Flagged)**

   - Introduce `PromptContextEngine` and layer schemas.
   - Teach `ContextManager` to return structured artifacts without changing public APIs by adding envelope building.
   - Emit both the old concatenated text and the new envelope so we can diff them during rollout.

2. **Runner Adoption**

   - Update `LLMChainRunner`, `CopilotPlusChainRunner`, `AutonomousAgentChainRunner`, `ProjectChainRunner`, and `VaultQAChainRunner` to prefer `PromptContextEnvelope.llmMessages`.
   - Maintain a fallback path to the old `userMessage.message` until confidence is high.
   - Ensure tool streaming (`ActionBlockStreamer`, `ThinkBlockStreamer`) keeps functioning because the outer `ChainRunner` API stays untouched.

3. **Provider Enhancements**

   - Once Layered Prefix is stable, add Gemini explicit cache + Anthropic breakpoints toggles controlled via model metadata so we only send extra fields when supported.

4. **Persistence & Migration**

   - Extend `ChatPersistenceManager` to serialize/deserialize layer metadata.
   - When loading older markdown, set a `legacyInlineContext` flag so the engine renders L1–L5 by treating everything (except final user sentence) as L3.
   - L2 context automatically rebuilds from message history on load (no migration needed).

5. **Rollout**
   - Enable the feature for Plus chains first (highest token usage), then expand to standard chains, vault QA, and finally the autonomous agent (which has the most complex tool interplay).
   - Monitor cached token metrics per provider to confirm wins.

## Backward Compatibility Strategies

- **ChainRunner contracts**: `ChainRunner.run()` signatures do not change; they simply swap the payload they hand to LangChain.
- **Tools**: Tool inputs/outputs remain the same; only their placement (L3 bucket) changes.
- **Markdown archives**: Continue storing full `processedText`. Layer metadata is additive and optional.
- **Settings**: No additional toggles required; the layered pipeline is always active and remains backward compatible with legacy chats.

## Testing & Observability

- **Unit**:
  - Layer renderer snapshot tests guaranteeing byte-identical output for fixed inputs.
  - L2 auto-promotion tests ensuring deterministic context collection from previous turns.
  - Deduplication tests verifying L3 takes priority over L2.
- **Integration**:
  - Golden prompt fixtures comparing legacy vs. layered output for representative chats (no context, heavy context, tool-heavy, multimodal).
  - ChainRunner streaming smoke tests verifying tool call markers still parse.
- **Telemetry/logging**:
  - Log layer hashes + provider usage cached token counts when debug logging is enabled.
  - Emit warnings if L1/L2 hash changes mid-conversation without an explicit trigger (indicates a bug).

## Open Questions

1. ~~Should `PinnedContextStore` live in `MessageRepository`?~~ **RESOLVED**: Not needed - L2 auto-promotion reads directly from message history
2. ~~How do we surface pin/unpin actions in the UI?~~ **RESOLVED**: No UI needed - auto-promotion is automatic and invisible
3. Do we need an explicit UI affordance for memory snapshots vs. automatic heuristics?
4. What is the best format for embedding layer metadata into markdown exports without confusing users (HTML comment vs. YAML frontmatter block)?
5. Can we amortize Dataview execution by caching query results per note + mtime to avoid re-running on every turn?

## Implementation Progress & Design Decisions

### Completed (Phase 1)

- Added canonical Layered Prefix types plus a singleton `PromptContextEngine` that renders deterministic L3/L5 payloads, hashes layers, and records debugging metadata.
- Updated `ContextManager` to return a `ContextProcessingResult` containing both the legacy concatenated text and the new prompt envelope, including structured turn-context segments (notes, tags, folders, URLs, selected text).
- Persisted `contextEnvelope` per message in `MessageRepository`, ensuring chat history, reprocessing, and persistence flows retain the new metadata without breaking existing UI consumers.
- Removed the temporary `enableLayeredContext` feature flag so the new system runs for every conversation while staying compatible with previously saved markdown chats.

### Design Simplifications

After reviewing the initial implementation, we made several simplifications to prioritize correctness, readability, and maintainability:

#### 1. Simplified Layer Serialization

- **Original Design**: Wrapped each layer in XML tags (`<L3_TURN>...</L3_TURN>`)
- **Simplification**: Use clean double-newline separation between layers
- **Rationale**: XML tags were redundant since layers are already structured data in the envelope. Simpler text is cleaner for LLM consumption.

#### 2. Deferred L4 (Conversation Strip Builder)

- **Original Design**: Build conversation strip with summary + last K turns, deterministic truncation
- **Simplification**: Defer to future phase, continue using existing LangChain memory management
- **Rationale**: Conversation strip is a token optimization, not required for cache correctness. Current memory management works fine. Adds significant complexity (summarization strategy, budget management, per-conversation storage).

#### 3. Deferred Provider-Specific Caching

- **Original Design**: Implement Gemini explicit cache, Anthropic `cache_control` breakpoints
- **Simplification**: Start with model-agnostic baseline only (stable prefixes for implicit caching)
- **Rationale**: Get baseline working first. Provider-specific optimizations are incremental gains that can be added later.

#### 4. Smart L2 Auto-Promotion (Implemented)

- **Final Design**: Automatic promotion of previous turn context to L2
- **Implementation**: Context from all previous turns automatically moves to L2, current turn stays in L3
- **Rationale**: Respects user intent (UI shows what's attached), achieves cache stability, requires no manual management

### Completed (Phase 2)

- **L2 Auto-Promotion**: Implemented `buildL2ContextFromPreviousTurns()` in `ContextManager` that collects context from all previous user messages
- **Deduplication Logic**: L3 (current turn) takes priority over L2 (previous turns) - items in L3 are removed from L2
- **Stable Ordering**: L2 context sorted by first appearance timestamp for deterministic cache hits
- **Type System Updates**: Renamed `L2_PINNED` → `L2_PREVIOUS` to reflect auto-promotion design
- **LayerToMessagesConverter**: Updated to handle L2_PREVIOUS with proper merging into user messages
- **All Tests Passing**: 1,173 tests pass including updated ChatManager and LayerToMessagesConverter tests

### In Progress (Phase 3)

- Wire prompt envelopes into `LLMChainRunner` with fallback to legacy

### Next (Phase 4)

- Wire envelopes into remaining ChainRunners (Plus, Project, VaultQA, Autonomous Agent)
- Add cache stability monitoring and validation
- Add integration tests for L2 auto-promotion behavior
- Test multimodal (images) with envelope-based extraction

### Future (Deferred to Later Phases)

- Provider-specific cache controls (Anthropic `cache_control`, Gemini explicit cache)
- Optional manual pinning UI (for users who want explicit control)
- L4 summarization (if needed - LangChain memory may be sufficient)

## ProcessedText Evolution & Migration Path

The new envelope-based system introduces a migration path away from the legacy `processedText` field (concatenated context) toward structured `contextEnvelope` layers.

### Phase 1 (Current): Dual Storage - Transition Period

Both `processedText` and `contextEnvelope` exist during migration:

```typescript
interface StoredMessage {
  displayText: string; // UI display and chat history
  processedText: string; // TRANSITIONAL: Legacy concatenated context
  contextEnvelope?: PromptContextEnvelope; // NEW: L1-L5 structured layers
}
```

**Usage:**

- ChainRunners being migrated use `contextEnvelope` if available
- Legacy ChainRunners fall back to `processedText`
- Both are populated to maintain compatibility

**When processedText is needed:**

1. Legacy ChainRunners (during transition) - until all runners use envelopes
2. Loading old chats - backwards compatibility with saved chats that lack envelopes
3. Fallback safety - when envelope building fails
4. Chat persistence - currently saved to markdown for full-text search

**When processedText is NOT needed:**

1. Chat history (`getLLMMessages()`) - use `displayText` only to avoid context duplication
2. New LLM requests - use `contextEnvelope` layers via `LayerToMessagesConverter`
3. Cache tracking - use envelope `layerHashes`

### Phase 2 (After ChainRunner Migration): Envelope Primary

After all ChainRunners are migrated, `processedText` becomes computed/cached:

```typescript
interface StoredMessage {
  displayText: string;
  contextEnvelope: PromptContextEnvelope; // PRIMARY

  // Optional computed property for legacy compatibility
  get processedText(): string;
}
```

**Benefits:**

- Single source of truth (envelope)
- `processedText` computed on-demand from `envelope.serializedText`
- No storage duplication

### Phase 3 (Future): Envelope Only

Eventually, drop `processedText` field entirely:

```typescript
interface StoredMessage {
  displayText: string; // For UI and history
  contextEnvelope: PromptContextEnvelope; // For LLM processing
}
```

**Requirements before Phase 3:**

- All ChainRunners migrated to envelope-based prompts
- Chat persistence uses envelope metadata only
- Legacy chat loading reconstructs envelopes from context metadata

## Migration Caveats: Multimodal Context (Images)

### Critical: Image Extraction from Context

`CopilotPlusChainRunner` and `AutonomousAgentChainRunner` extract embedded images from note context XML tags:

```typescript
// CopilotPlusChainRunner.ts
private extractNoteContent(textContent: string): string {
  // Extracts content from <note_context> and <active_note> blocks
  const noteContextRegex = /<note_context>([\s\S]*?)<\/note_context>/g;
  const activeNoteRegex = /<active_note>([\s\S]*?)<\/active_note>/g;
  // ...
}

private async extractEmbeddedImages(content: string, sourcePath?: string): Promise<string[]> {
  // Finds ![[image.ext]] and ![](image.url) in note content
  // ...
}
```

**Current behavior (legacy):**

- Note context appended to user message: `userMessage.message` contains `<note_context>...</note_context>`
- Image extraction runs on full `userMessage.message`
- Finds images in `<note_context>` blocks

**New behavior (envelope-based):**

- Note context in L3 layer: envelope contains structured segments
- User message (L5) is raw: `"Summarize this"` (no XML tags)
- **Risk**: Image extraction might miss images in L3 if it only looks at L5!

### Solution Strategy

When migrating CopilotPlus and Agent runners:

1. **Extract from full envelope content**, not just `userMessage.message`:

   ```typescript
   // Get full user content including L3 context
   const fullContent = LayerToMessagesConverter.extractUserContent(envelope);
   // This merges L2 + L3 + L5, includes all <note_context> blocks

   const noteContent = this.extractNoteContent(fullContent);
   const images = await this.extractEmbeddedImages(noteContent, sourcePath);
   ```

2. **Or extract from envelope layers directly**:

   ```typescript
   const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
   if (l3Turn) {
     const noteContent = this.extractNoteContent(l3Turn.text);
     const images = await this.extractEmbeddedImages(noteContent, sourcePath);
   }
   ```

3. **Test multimodal messages with note context** to verify images are extracted correctly

### Testing Checklist for Multimodal Migration

- [ ] Test image in note context with CopilotPlus chain
- [ ] Test image in active note with CopilotPlus chain
- [ ] Test wiki-style image links `![[image.png]]`
- [ ] Test markdown image links `![](image.png)`
- [ ] Test image URLs in note content
- [ ] Verify images appear in final LLM request
- [ ] Test with Agent chain (similar image extraction logic)

## Chat Persistence Strategy

### Requirements

1. **Backward Compatibility**: Saved markdown files must continue to mirror the UI display (display text only)
2. **Context Reconstruction**: On load, rebuild L3 context from saved metadata
3. **No Breaking Changes**: Existing saved chats must load correctly

### Current Persistence Format

`ChatPersistenceManager` saves messages with:

- Display text (what user typed / AI responded)
- Context metadata (`MessageContext` with notes, tags, folders, URLs)
- Sources, timestamps, etc.

### Persistence Strategy

#### Saving Chats

```
For each message:
  1. Save displayText (UI view) → markdown file
  2. Save MessageContext metadata (notes[], tags[], folders[], urls[])
  3. Do NOT save processedText (context-heavy version)
  4. Optional: Save contextEnvelope for faster reload
```

#### Loading Chats

```
For each loaded message:
  1. Display: Show displayText in UI (same as before)
  2. Reconstruction: Use MessageContext metadata to rebuild L3 context
     - For user messages: Reprocess context from notes/tags/folders
     - Build fresh envelope with current note content
  3. Memory: Store displayText only in LangChain history
```

#### Context Reconstruction Details

When loading a chat from markdown:

1. **User Messages**:

   - UI shows: "Summarize this note"
   - Stored metadata: `{ notes: ["meeting-notes.md"], tags: [], folders: [] }`
   - On load: Reprocess "meeting-notes.md" to build fresh L3 context
   - Envelope: L1 (system) + L3 (fresh note content) + L5 ("Summarize this note")

2. **AI Messages**:

   - UI shows: AI response text
   - Stored as-is (no context processing needed)

3. **Stale Context Handling**:
   - If a referenced note was deleted: Skip it, log warning
   - If note content changed: Use current content (expected behavior)
   - If note was moved: Try to resolve by basename

#### Benefits

- **No Duplication**: Chat history contains raw messages only
- **Fresh Context**: Loaded chats get current note content, not stale snapshots
- **Compact Storage**: Markdown files stay lean
- **Cache-Friendly**: L1/L2 remain stable across reloaded chats

#### Implementation Notes

1. `MessageRepository.loadMessages()` already accepts `ChatMessage[]` with `context` field
2. `ChatPersistenceManager` already serializes/deserializes context metadata
3. Need to ensure: On load, trigger context reprocessing for each user message
4. Alternative: Store `contextEnvelope` in markdown for faster reload (trade-off: larger files)
