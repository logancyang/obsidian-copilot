# Context Engineering - Layered Prefix System

## Table of Contents

1. [Overview](#overview)
2. [Layered Prefix Architecture (L1-L5)](#layered-prefix-architecture-l1-l5)
3. [Current Implementation Status](#current-implementation-status)
4. [Architecture Components](#architecture-components)
5. [Tool System Design](#tool-system-design)
6. [Testing & Migration](#testing--migration)
7. [Historical Context](#historical-context)

---

## Overview

### Intent

Copilot's layered context system (L1-L5) enables provider-side prefix caching by organizing prompt content from most stable (L1) to most volatile (L5). This prevents duplicate context transmission across turns and allows deterministic token budget control.

### Design Goals

- **Layered prefix** (L1–L5) ordered from most stable to most volatile for cache hits
- **Model-agnostic** baseline: OpenAI/Gemini implicit caching, Anthropic long-context guidance
- **Provider-aware optimizations** (optional): Gemini explicit cache, Anthropic `cache_control`
- **No contract changes** for `ChainRunner` or tool execution APIs
- **Backward compatibility** with existing chat markdown exports

### Key Benefits

- **Maximum cache stability**: L2 grows monotonically → cache hits maximized
- **Minimal redundancy**: Items in L2 referenced by ID in L3 → fewer tokens
- **Smart referencing**: Clear instructions to find context in Context Library
- **Simple logic**: Set membership test decides ID vs. full content

---

## Layered Prefix Architecture (L1-L5)

### Layer Definitions

| Layer                     | Source                                  | Update Trigger                   | Purpose                                        |
| ------------------------- | --------------------------------------- | -------------------------------- | ---------------------------------------------- |
| **L1: System & Policies** | System prompt + user memory             | Only when settings/memory change | Cacheable prefix with instructions             |
| **L2: Context Library**   | ALL previous context items (cumulative) | Grows with new context           | Stable reference library                       |
| **L3: Smart References**  | Current turn context                    | Every turn                       | References L2 by ID, new items as full content |
| **L4: Chat History**      | LangChain memory (raw messages)         | Each Q/A pair                    | Conversation continuity                        |
| **L5: User Message**      | Raw user input                          | Every turn                       | Minimal user query                             |

### L2: Context Library (Cumulative Design)

**Key Insight**: L2 is a simple cumulative library of all context ever seen in the conversation.

**Rules**:

1. **Cumulative**: Grows monotonically, never shrinks
2. **Auto-promotion**: Context from previous turns automatically moves to L2
3. **Smart referencing**: Items in L2 referenced by path/ID in L3
4. **New items only**: L3 includes full content only for brand-new items

**Example Flow**:

```
Turn 1: User adds project-spec.md
  L1: System prompt
  L2: (empty)
  L3: <note_context>project-spec.md (full content)</note_context>  ← NEW
  L5: "Summarize this"

Turn 2: User keeps project-spec.md, adds api-docs.md
  L1: System prompt (stable ✅)
  L2: <note_context>project-spec.md (full content)</note_context>  ← Promoted to library
  L3: "Context attached:
        - Piano Lessons/project-spec.md
       Find them in the Context Library above."
       <note_context>api-docs.md (full content)</note_context>  ← NEW
  L5: "What's the API?"

Turn 3: User keeps project-spec.md only
  L1: System prompt (stable ✅)
  L2: <note_context>project-spec.md</note_context>
      <note_context>api-docs.md</note_context>  ← STABLE! Cache hit!
  L3: "Context attached:
        - Piano Lessons/project-spec.md
       Find them in the Context Library above."  ← Just ID reference
  L5: "Explain that"
```

### Unique Identifiers

- **Notes**: Full file path (`note.path`)
- **URLs**: Full URL string
- **Selected text**: Source file path + line range
- **Dataview blocks**: Source file path + query hash

---

## Current Implementation Status

### ✅ Completed (Production)

1. **Phase 1: Foundations**

   - ✅ `PromptContextEngine` with deterministic L3/L5 rendering
   - ✅ `ContextManager` returns structured `ContextProcessingResult`
   - ✅ `MessageRepository` persists `contextEnvelope` per message
   - ✅ Feature flag removed - system active for all conversations

2. **Phase 2: L2 Auto-Promotion**

   - ✅ `buildL2ContextFromPreviousTurns()` collects previous context
   - ✅ Cumulative L2 (no deduplication from current turn)
   - ✅ Segment-based smart referencing with path IDs
   - ✅ `LayerToMessagesConverter` handles smart references

3. **Phase 3: ChainRunner Migration**
   - ✅ `LLMChainRunner` envelope-based
   - ✅ `VaultQAChainRunner` envelope-based
   - ✅ `CopilotPlusChainRunner` envelope-based with uniform tool handling
   - ✅ `AutonomousAgentChainRunner` envelope-based with iterative tool loop
   - ✅ `ProjectChainRunner` envelope-based with project context in L1

### 🎯 Current Design: Uniform Tool Placement

**System Message** = L1 (system prompt) + L2 (Context Library) ONLY
**User Message** = Tool results + L3 (smart refs) + L5 (user query)

All tools (`localSearch`, `webSearch`, `getFileTree`, etc.) are treated uniformly:

- Wrapped as `<toolName>content</toolName>`
- Prepended to user message using CiC (Context in Context) format
- Turn-specific, never promoted to L2

### 🔄 In Progress / Deferred

**Next Phase**:

- Cache stability monitoring

**Future Enhancements** (deferred):

- Provider-specific cache controls (Anthropic `cache_control`, Gemini explicit cache)
- L4 conversation strip with summarization
- Optional manual pinning UI

---

## Chain Integration Summary

### LLMChainRunner

- Replaced legacy prompt assembly with `LayerToMessagesConverter` output.
- System message = envelope L1 + L2 only; no tool payloads injected.
- User message = L3 smart references + L5; supports composer instructions via shared helper.
- Payload recorder logs layered view for every request.

### VaultQAChainRunner

- Uses envelope-derived system message (L1/L2) plus chat history before user turn.
- Vault RAG results and citation guidance prepended to user message, keeping system cacheable.
- Applies CiC ordering so the user question follows retrieved documents.
- Multimodal handling respects envelope rules (images only from active note).

### CopilotPlusChainRunner

- Intent analysis still Broca-based (ToolCallPlanner pending), but prompt assembly is envelope-first.
- All tool outputs (localSearch, webSearch, file tree, etc.) formatted uniformly and prepended to user message.
- LocalSearch payload is self-contained: includes RAG instruction, documents, and citation guidance all within the `<localSearch>` block.
- Each localSearch call carries its own guidance block (source catalog + citation rules), ensuring correct citations in multi-search turns.
- Composer instructions appended once to avoid duplication; payload recorder captures tool XML alongside L3/L5.

### AutonomousAgentChainRunner

- Validates envelope presence and reuses converter for baseline messages.
- System prompt combines envelope L1/L2 with tool descriptions from model adapters (no duplicate base prompt).
- L5 text flows through adapter hints so GPT/Claude reminders continue to fire.
- Iterative tool loop reuses existing Think/Action streamers; prompt recorder receives envelope for each run.

### ProjectChainRunner

- Fully migrated to envelope-based context construction.
- Project context automatically added to L1 via `ChatManager.getSystemPromptForMessage()`.
- No special-case logic needed - inherits all behavior from `CopilotPlusChainRunner`.

#### Implementation

1. **Centralized L1 assembly with helper method.**
   Added `ChatManager.getSystemPromptForMessage(chainType)` that calls `await getSystemPromptWithMemory(...)`, then (for `PROJECT_CHAIN` only) appends project system/context blocks:

   ```ts
   async getSystemPromptForMessage(chainType: ChainType): Promise<string> {
     const basePrompt = await getSystemPromptWithMemory(this.chainManager.userMemoryManager);

     // Special case: Add project context for project chain
     if (chainType === ChainType.PROJECT_CHAIN) {
       const project = getCurrentProject();
       if (project) {
         const context = await ProjectManager.instance.getProjectContext(project.id);
         let result = `${basePrompt}\n\n<project_system_prompt>\n${project.systemPrompt}\n</project_system_prompt>`;

         // Only add project_context block if context exists (guards against null)
         if (context) {
           result += `\n\n<project_context>\n${context}\n</project_context>`;
         }

         return result;
       }
     }
     return basePrompt;
   }
   ```

2. **Null guard for project context.**
   When `ProjectManager.instance.getProjectContext()` returns `null` (e.g., context still loading or cache miss), the `<project_context>` block is omitted entirely rather than interpolating the literal string "null" into L1.

3. **Envelope integration.**
   The helper's return value is passed into `processMessageContext` / `reprocessMessageContext`. `PromptContextEngine` serializes the full string into the L1 layer, so `ProjectChainRunner` drops its bespoke `getSystemPrompt` override and reuses the envelope just like Copilot Plus.

4. **Simplified ProjectChainRunner.**
   The class is now just a pass-through to `CopilotPlusChainRunner` with no overrides - project context automatically appears in L1 via `ChatManager`.

---

## Architecture Components

### 1. PromptContextEngine

**Purpose**: Centralizes prompt assembly, replacing "context baked into message" workflow.

**Input**: `PromptContextRequest`

- `chatId`, `currentMessageId`
- User text, structured attachments
- Tool outputs, provider metadata
- Token budget hints

**Output**: `PromptContextEnvelope`

- `layers` (L1-L5 structured)
- `llmMessages` (formatted for provider)
- `renderedSegments` (serialized layers)
- Cache hints (`layerHashes`)
- Back-compat `processedUserText`

### 2. Layer Builders

**L2 Builder**:

- Collects context from all previous messages
- Deduplicated by unique ID (note path, URL)
- Sorted by first appearance for stability
- Excludes current turn's L3

**L3 TurnContextAssembler**:

- Reuses `ContextProcessor` for current message only
- Emits structured entries: `{ id, type, sha256, content }`
- Smart referencing logic (ID vs. full content)

**L4 History**:

- Provided by LangChain memory (`MessageRepository.getLLMMessages()`)
- Returns raw messages without context

**Renderer**:

- Deterministically serializes each layer
- Whitespace normalization for byte-identical outputs
- Hash generation for cache validation

### 3. LayerToMessagesConverter

**Purpose**: Converts envelope to provider-ready messages with smart referencing.

**Smart Referencing Logic**:

```typescript
// Parse L2 into segments by unique ID
const l2SegmentIds = new Set(parseContextIntoSegments(l2Text).map((s) => s.id));

// For each item in L3:
if (l2SegmentIds.has(itemId)) {
  // Reference by ID: "Find Piano Lessons/project-spec.md in Context Library above"
} else {
  // Include full content: <note_context>full content</note_context>
}
```

### 4. Data Persistence

**MessageRepository**:

- Stores `contextEnvelope?: SerializedLayerRef` per message
- Contains L3 entries + pointers to L1/L2/L4 snapshots
- Backward compatible with legacy `processedText`

**ChatPersistenceManager**:

- Saves `displayText` + context metadata to markdown
- Hidden JSON frontmatter for layer reconstruction: `<!-- copilot-context: {...} -->`
- On load: rebuild envelope from metadata (legacy mode if missing)

**ProcessedText Evolution**:

- **Phase 1 (Current)**: Dual storage - both `processedText` and `contextEnvelope`
- **Phase 2 (After migration)**: `processedText` becomes computed from envelope
- **Phase 3 (Future)**: Drop `processedText` entirely

---

## Tool System Design

### Uniform Tool Placement

**All tools go to user message** - no special cases:

```typescript
// System message: L1 + L2 only
messages.push({
  role: "system",
  content: systemMessage.content, // Just L1 + L2, no tools
});

// User message: Tools + L3 + L5
const toolContext = formatAllToolOutputs(allToolOutputs); // Uniform for all tools
const finalUserContent = renderCiCMessage(
  toolContext, // <localSearch>...</localSearch>\n<webSearch>...</webSearch>
  userMessageContent.content, // L3 smart refs + L5
  false
);
```

### Tool Output Formatting

**All tools use consistent XML wrapping**:

```xml
# Additional context:

<localSearch timeRange="last week">
Answer the question based only on the following context:

[Retrieved documents...]

<guidance>
[Citation rules and source catalog...]
</guidance>
</localSearch>

<webSearch>
[Web search results...]
</webSearch>
```

**Key Points**:

- Each tool wrapped as `<toolName>content</toolName>`
- Prepended to user message via `renderCiCMessage()`
- RAG instruction ("Answer based on context") included in localSearch output
- Citation guidance included directly within each `<localSearch>` block (self-contained)
- Multi-search turns: each localSearch has its own guidance block with source mappings
- Turn-specific, never cached in L2

### Intent Analysis

**Current**: `IntentAnalyzer` analyzes L5 (raw user query) for tool selection

**Future (Deferred)**: `ToolCallPlanner`

- Uses user's chat model instead of Broca API
- Input: L5 + L3 summary (metadata only, not full content)
- Output: JSON tool-call array with schema validation
- Shared between CopilotPlus and Agent chains

---

## Testing & Migration

### Testing Strategy

**Unit Tests**:

- Layer renderer snapshot tests (byte-identical output)
- L2 auto-promotion tests (deterministic collection)
- Smart referencing tests (ID vs. full content logic)
- Deduplication tests (L3 priority over L2)

**Integration Tests**:

- Golden prompt fixtures (no context, heavy context, tool-heavy, multimodal)
- ChainRunner streaming smoke tests
- Tool marker parsing validation

**Observability**:

- Log layer hashes + cached token counts (debug mode)
- Warn if L1/L2 hash changes mid-conversation without trigger
- Prompt payload recorder with layered view

### Migration Caveats

#### Multimodal (Images)

**Constraint**: Image extraction must read from envelope, not raw message.

**Solution** (CopilotPlusChainRunner):

```typescript
// Extract images from active note ONLY (in L3)
const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
if (l3Turn) {
  const activeNoteRegex = /<active_note>([\s\S]*?)<\/active_note>/;
  const activeNoteMatch = activeNoteRegex.exec(l3Turn.text);
  if (activeNoteMatch) {
    const sourcePath = extractPath(activeNoteMatch[1]);
    const content = extractContent(activeNoteMatch[1]);
    const images = await this.extractEmbeddedImages(content, sourcePath);
  }
}
```

**Rules**:

- Extract from `<active_note>` only (not `<note_context>`)
- Never promote image-bearing notes to L2
- Legacy behavior unchanged (no envelope fallback)

#### Chat Persistence

**Saving** (ChatPersistenceManager.formatChatContent):

1. Save `displayText` (UI view) to markdown
2. Save context metadata with **full vault-relative paths**:
   - Notes: `[Context: Notes: Piano Lessons/Lesson 4.md, DailyNotes/2025-01-27.md]`
   - URLs, tags, folders saved as-is
3. `contextEnvelope` NOT saved (deliberate - want fresh content on load)

**Loading** (ChatPersistenceManager.parseContextString):

1. Parse context metadata from markdown
2. Resolve note paths via vault lookup:
   - **Primary**: Resolve by full path (`app.vault.getAbstractFileByPath()`)
   - **Fallback**: Resolve by basename if unique (backward compatibility)
   - **Skip**: If deleted or ambiguous, log warning and continue
3. Return resolved TFile[] for context.notes
4. When conversation continues: `buildL2ContextFromPreviousTurns()` processes resolved notes with fresh content

**Stale Context Handling**:

- **Deleted note**: Skip with warning, continue without it
- **Changed content**: Use current content (expected - provides fresh context)
- **Moved note**: Resolves via basename fallback if unique, otherwise skips
- **Ambiguous basename**: Multiple matches → skip with warning listing all matches

**Backward Compatibility** (2025-01-27 update):

- **Old chats** (basenames only): Basename fallback resolution attempts vault-wide search
- **New chats** (full paths): Direct resolution, faster and unambiguous
- **Migration**: Automatic - no user action needed

### Backward Compatibility

**ChainRunner Contracts**:

- `ChainRunner.run()` signatures unchanged
- Envelope passed via `userMessage.contextEnvelope`
- Fallback to `processedText` if envelope missing

**Markdown Archives**:

- Continue storing full `processedText`
- Layer metadata additive and optional
- Legacy chats rebuild on load (compat mode)

**Settings**:

- No new toggles required
- System always active, backward compatible

---

## Historical Context

### Design Simplifications

#### 1. Simplified Layer Serialization

- **Original**: XML tags wrapping each layer (`<L3_TURN>...</L3_TURN>`)
- **Simplification**: Clean double-newline separation
- **Rationale**: XML redundant, simpler text cleaner for LLM

#### 2. Deferred L4 Conversation Strip

- **Original**: Summary + last K turns with deterministic truncation
- **Simplification**: Continue using existing LangChain memory
- **Rationale**: Token optimization, not required for cache correctness

#### 3. Deferred Provider-Specific Caching

- **Original**: Gemini explicit cache, Anthropic `cache_control`
- **Simplification**: Model-agnostic baseline only (stable prefixes)
- **Rationale**: Baseline first, optimizations incremental

### Bug Fixes

#### L2 Context Deduplication Bug (2025-01-25)

**Problem**: `buildL2ContextFromPreviousTurns()` removed items from L2 if they appeared in current turn, breaking cache stability.

**Symptom**: Same note sent twice across consecutive turns instead of being referenced by ID.

**Root Cause**:

```typescript
// WRONG: Prevents L2 accumulation
if (currentTurnContext) {
  const currentTurnNotePaths = new Set((currentTurnContext.notes || []).map((note) => note.path));
  for (const notePath of currentTurnNotePaths) {
    uniqueNotes.delete(notePath); // BUG
  }
}
```

**Fix**:

1. Removed deduplication logic from `buildL2ContextFromPreviousTurns()`
2. L2 contains ALL previous context (no filtering)
3. `LayerToMessagesConverter` compares segment IDs for smart referencing

**Result**: L2 grows monotonically ✅ Cache hits maximized ✅

#### Uniform Tool Placement Refactor (2025-01-27)

**Problem**: Architectural complexity with localSearch in system message vs. other tools in user message.

**Old Design**:

- `localSearch` → system message (RAG as authoritative knowledge)
- Other tools → user message (supplementary info)
- Complex branching logic, special-casing

**New Design**:

- ALL tools → user message uniformly
- System = L1 + L2 only (cacheable prefix)
- Single code path: `formatAllToolOutputs()`

**Benefits**:

- Eliminated ~100 lines of special-case code
- Clear cache boundary
- Automatic tool detection via `ToolRegistry`

### Implementation Progress Phases

**Phase 1** (Completed):

- Canonical Layered Prefix types
- `PromptContextEngine` singleton
- `ContextManager` structured output
- `MessageRepository` envelope persistence

**Phase 2** (Completed):

- L2 auto-promotion implementation
- Cumulative L2 design (no deduplication)
- Segment-based smart referencing
- Stable ordering by first appearance

**Phase 3** (Completed):

- LLM chain envelope migration
- VaultQA chain envelope migration
- CopilotPlus chain envelope migration + uniform tools
- Agent chain envelope migration + iterative tool loop
- Payload logging with layered view

**Phase 4** (Deferred):

- Provider-specific cache controls
- Optional manual pinning UI
- L4 conversation strip with summarization

### Agent Chain Runner Implementation

**Goal**: Integrate the autonomous agent chain with the layered context system, following the same envelope-first architecture as CopilotPlus while preserving the iterative tool execution loop.

**Implementation** (Completed 2025-01-27):

The agent chain integration follows the CopilotPlus pattern with minimal changes to support the unique iterative tool loop:

**1. Envelope Extraction & Validation**

- Added envelope validation at start of `run()` method
- Fails fast with clear error if envelope missing
- Logs envelope-based context construction for debugging

**2. System Message Construction**

```typescript
// Extract L1+L2 from envelope via LayerToMessagesConverter
const baseMessages = LayerToMessagesConverter.convert(envelope, {
  includeSystemMessage: true,
  mergeUserContent: true,
});

// Combine with tool descriptions from model adapter
const systemContent = [
  systemMessage?.content || "", // L1 + L2 from envelope
  toolDescriptionsPrompt || "", // Tool descriptions + guidelines
]
  .filter(Boolean)
  .join("\n\n");
```

**3. Initial User Message Assembly**

- Extract L3 (smart references) + L5 (user query) from converter
- Build multimodal content if images present (inherited from CopilotPlus)
- No adapter enhancement needed (envelope contains formatted content)

**4. Original Prompt Extraction**

- Extract L5 text for CiC ordering in tool results
- Used by `applyCiCOrderingToLocalSearchResult()` to append question

**5. Agent Loop (Unchanged)**

- Tool execution, parsing, and result formatting remain identical
- Tool results added to conversation as assistant/user message pairs
- CiC ordering applied to localSearch results as before
- ThinkBlockStreamer and ActionBlockStreamer preserved
- Iteration history and source collection unchanged

**Key Design Points**:

- **Minimal changes**: Only `prepareAgentConversation()` and envelope extraction modified
- **Tool system preserved**: All tool execution, streaming, and display logic unchanged
- **Message structure**: System (L1+L2+tools) → History → User (L3+L5) → Agent loop
- **Tool results**: Continue to be added to conversation messages, never promoted to L2
- **Multimodal support**: Image extraction inherited from CopilotPlus base class

**Differences from CopilotPlus**:

| Aspect             | CopilotPlus                               | Agent                                       |
| ------------------ | ----------------------------------------- | ------------------------------------------- |
| **Tool Execution** | Pre-run (single batch via IntentAnalyzer) | Iterative loop (multi-turn)                 |
| **Tool Results**   | Formatted once, prepended to user message | Accumulated across iterations               |
| **System Prompt**  | L1 + L2                                   | L1 + L2 + tool descriptions + guidelines    |
| **Conversation**   | Single turn                               | Multiple assistant/user pairs per iteration |
| **Streaming**      | ThinkBlockStreamer only                   | ThinkBlockStreamer + ActionBlockStreamer    |

---

## Open Questions

1. ~~L2 storage location?~~ **RESOLVED**: Auto-promotion from message history
2. ~~Pin/unpin UI?~~ **RESOLVED**: Auto-promotion, no UI needed
3. Memory snapshot UI affordance? (Deferred)
4. Layer metadata format in markdown exports? (HTML comment vs. YAML frontmatter)
5. Dataview query caching by note + mtime? (Optimization, not critical)

---

## References

### Key Files

- **Core**: `src/context/PromptContextEngine.ts`, `src/core/ContextManager.ts`
- **Layer Conversion**: `src/context/LayerToMessagesConverter.ts`
- **Persistence**: `src/core/MessageRepository.ts`, `src/core/ChatPersistenceManager.ts`
- **Chain Runners**: `src/LLMProviders/chainRunner/*.ts`
- **Utilities**: `src/LLMProviders/chainRunner/utils/cicPromptUtils.ts`

### Related Documentation

- Message Architecture: `docs/MESSAGE_ARCHITECTURE.md`
- Technical Debt: `docs/TECHDEBT.md`
- Current Tasks: `TODO.md`
