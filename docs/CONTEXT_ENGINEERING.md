# Context Engineering - Layered Prefix System

## Table of Contents

1. [Purpose](#purpose)
2. [First-Principles Goals](#first-principles-goals)
3. [Current Architecture (Verified)](#current-architecture-verified)
4. [Example Chat Walkthrough](#example-chat-walkthrough)
5. [Chain Runner Envelope Usage](#chain-runner-envelope-usage)
6. [Strengths](#strengths)
7. [Known Gaps](#known-gaps)
8. [Improvement Roadmap](#improvement-roadmap)
9. [Testing and Observability](#testing-and-observability)
10. [References](#references)

---

## Purpose

The context envelope system is the canonical prompt-construction pipeline for chat turns.

It exists to guarantee:

- reproducible prompt assembly,
- minimal duplication across L2/L3/L4,
- safe compaction behavior on large context,
- and cache-friendly request prefixes for major providers.

This document is an implementation audit and roadmap based on current production code.

---

## First-Principles Goals

### 1. Reproducibility

For the same turn inputs, envelope construction should be deterministic and byte-stable.

### 2. Token Efficiency

Context artifacts should appear once in canonical form (or as references), not duplicated across layers.

### 3. Prefix Cache Stability

Stable content should stay in early request tokens (L1/L2) so implicit provider caching has maximal hit rate.

### 4. Compaction Safety

Compaction must preserve answerability and recovery affordances, especially for non-recoverable context.

### 5. Persistence Parity

Loading chat history should preserve envelope quality (or deterministically reconstruct it), so behavior after load matches in-session behavior.

---

## Current Architecture (Verified)

### Layer Definitions

| Layer           | Current Source                                               | Update Trigger                  | Stability |
| --------------- | ------------------------------------------------------------ | ------------------------------- | --------- |
| **L1_SYSTEM**   | `ChatManager.getSystemPromptForMessage()`                    | settings/memory/project changes | High      |
| **L2_PREVIOUS** | Auto-promoted previous user-turn L3 segments                 | per user turn                   | Medium    |
| **L3_TURN**     | Current-turn context artifacts (notes/URLs/tags/folders/etc) | every user turn                 | Low       |
| **L4_STRIP**    | Deferred in envelope, injected from LangChain memory         | every turn                      | Low       |
| **L5_USER**     | processed user query (templated user text)                   | every user turn                 | Lowest    |

### End-to-End Flow

1. `ChatManager.sendMessage()` creates a user message and resolves L1 system prompt.
2. `ContextManager.processMessageContext()`:
   - builds L2 from previous user messages' stored envelopes,
   - processes current-turn context artifacts,
   - optionally compacts large context,
   - builds `PromptContextEnvelope` via `PromptContextEngine`.
3. `MessageRepository.updateProcessedText()` stores both legacy `processedText` and `contextEnvelope`.
4. Chain runners require `contextEnvelope`, convert with `LayerToMessagesConverter`, inject L4 from memory, then append tool context into user-side payload.

### L2/L3 Smart Referencing

- L2 is now deduplicated by segment ID with last-write-wins content updates and stable first-seen ordering.
- L3 segments whose IDs already exist in L2 are rendered as references; new IDs include full content.
- Segment parsing is centralized in `parseContextIntoSegments()` using `contextBlockRegistry` tags.

### Tool Placement Model

- System message contains only L1 + L2.
- Tool outputs remain turn-scoped and are prepended to user-side content (`CiC` ordering).
- This keeps cacheable prefix isolated from tool variability.

### Persistence Behavior

- Chat markdown persists message text plus context references (`[Context: ...]`), not full envelopes.
- On load, messages are restored without `contextEnvelope`.
- Regeneration now has lazy reprocessing: if envelope is missing, `ChatManager.regenerateMessage()` reprocesses the target user message before running the chain.
- Continuing chat after load still does not automatically reconstruct historical envelopes for prior turns.

### Compaction Stack

- **Turn-time compaction** (`ContextCompactor`): map-reduce summarization when total context exceeds threshold.
- **L2 carry-forward compaction** (`compactSegmentForL2` + `L2ContextCompactor`): deterministic structure+preview compression for promoted previous context.

### L4 Memory Behavior

- L4 (chat history) is injected by chain runners from LangChain `BufferWindowMemory`.
- **Only `displayText` (raw user message) is saved to memory** — context artifacts are NOT included.
- This prevents duplication: context artifacts already live in L2/L3 via the envelope; baking them into L4 would cause triple-inclusion and waste tokens.
- Assistant responses are saved as-is (or with tool-call formatting stripped).

---

## Example Chat Walkthrough

This shows the concrete layer contents across a 3-turn conversation. The user attaches `project-spec.md` in Turn 1, adds `api-docs.md` in Turn 2, then drops `api-docs.md` in Turn 3.

### Turn 1: User adds `project-spec.md`

```
L1 (System):
  [system prompt + user memory + project instructions]

L2 (Previous Context Library):
  (empty — first turn, no prior context)

L3 (Current Turn Context):
  <note_context>
  <title>project-spec</title>
  <path>project-spec.md</path>
  <content>... full note content ...</content>
  </note_context>
  → Segment ID: "project-spec.md" (NEW — full content included)

L4 (Chat History):
  (empty — first turn)

L5 (User Message):
  "Summarize this"
```

After Turn 1, `BaseChainRunner.handleResponse()` saves to memory:

- Input: `"Summarize this"` (displayText only — no context XML)
- Output: `"Here is a summary of the project spec..."`

### Turn 2: User keeps `project-spec.md`, adds `api-docs.md`

```
L1 (System):
  [system prompt — stable ✅, cache-friendly]

L2 (Previous Context Library):
  <prior_context source="project-spec.md" type="note">
  Structure: project-spec (project-spec.md) | Preview: ...first 200 chars...
  </prior_context>
  → Segment ID: "project-spec.md" (promoted from Turn 1 L3, compacted for L2)

L3 (Current Turn Context):
  Context attached to this message:
  - project-spec.md

  Find them in the Context Library in the system prompt above.

  <note_context>
  <title>api-docs</title>
  <path>docs/api-docs.md</path>
  <content>... full note content ...</content>
  </note_context>
  → "project-spec.md" rendered as REFERENCE (already in L2)
  → "docs/api-docs.md" is NEW — full content included

L4 (Chat History):
  Human: "Summarize this"
  AI: "Here is a summary of the project spec..."
  → Only displayText — no context XML in L4

L5 (User Message):
  "What endpoints does the API support?"
```

### Turn 3: User keeps `project-spec.md` only (drops `api-docs.md`)

```
L1 (System):
  [system prompt — stable ✅]

L2 (Previous Context Library):
  <prior_context source="project-spec.md" type="note">
  Structure: project-spec (project-spec.md) | Preview: ...first 200 chars...
  </prior_context>
  <prior_context source="docs/api-docs.md" type="note">
  Structure: api-docs (docs/api-docs.md) | Preview: ...first 200 chars...
  </prior_context>
  → Both deduplicated by segment ID. "project-spec.md" retains its
    first-seen position; "docs/api-docs.md" added after.
  → L2 is CUMULATIVE and STABLE — cache hit for the prefix ✅

L3 (Current Turn Context):
  Context attached to this message:
  - project-spec.md

  Find them in the Context Library in the system prompt above.
  → "project-spec.md" is a REFERENCE (in L2)
  → "docs/api-docs.md" is NOT referenced (user didn't attach it this turn)
    but it remains in L2 for cache stability and potential follow-up use

L4 (Chat History):
  Human: "Summarize this"
  AI: "Here is a summary of the project spec..."
  Human: "What endpoints does the API support?"
  AI: "The API supports the following endpoints..."
  → Clean displayText only — no bloat

L5 (User Message):
  "Explain the auth flow from the spec"
```

### Key Behaviors Demonstrated

| Behavior                        | Where       | Example                                                           |
| ------------------------------- | ----------- | ----------------------------------------------------------------- |
| **Per-artifact segment IDs**    | L3 parsing  | `"project-spec.md"`, `"docs/api-docs.md"` — not generic `"notes"` |
| **L2 dedup (last-write-wins)**  | L2 build    | Same ID across turns → content updated, position preserved        |
| **Smart referencing**           | L3 render   | Items in L2 become `- project-spec.md` references                 |
| **L2 cumulative growth**        | L2 library  | `api-docs.md` stays in L2 even when dropped from L3               |
| **L2 carry-forward compaction** | L2 content  | Full `<note_context>` → `<prior_context>` with structure+preview  |
| **L4 displayText only**         | Memory save | `"Summarize this"` — no `<note_context>` XML                      |
| **Prefix cache stability**      | L1+L2       | L1 stable across turns; L2 grows monotonically, doesn't shrink    |

---

## Chain Runner Envelope Usage

All four chain runners use the context envelope for LLM message construction. Each delegates final response handling to `BaseChainRunner.handleResponse()`, which saves only L5 text (expanded user query, no context XML) to L4 memory.

### Per-Runner Behavior

| Runner                         | Envelope Construction                                                                 | Tool Results                                                  | User Message Source  |
| ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------- |
| **LLMChainRunner**             | `LayerToMessagesConverter.convert()` → system (L1+L2), user (L3 refs + L5)            | None                                                          | Envelope only        |
| **CopilotPlusChainRunner**     | Same converter, then `ensureUserQueryLabel` adds `[User query]:` separator            | Prepended to user message in CiC order                        | L5 text via envelope |
| **AutonomousAgentChainRunner** | Same converter for initial messages; ReAct loop appends AI + ToolMessages iteratively | Native tool calling — each result is a separate `ToolMessage` | L5 text via envelope |
| **VaultQAChainRunner**         | Same converter                                                                        | Retrieval results via hybrid/lexical retriever                | Envelope only        |

### CopilotPlus: Single-Shot Tool Flow

1. Planning phase analyzes L5 text to determine which `@commands` to execute.
2. Tool results (localSearch, web fetch, etc.) are formatted and prepended to the user message using CiC ordering: `[tool results] → [L3 references + L5 with User query label]`.
3. Single LLM call with the complete message array: `[system (L1+L2)] → [L4 history] → [user (tools + L3 + L5)]`.

### Autonomous Agent: ReAct Loop Flow

1. Initial message array built identically to CopilotPlus: `[system (L1+L2+tool guidelines)] → [L4 history] → [user (L3 refs + L5)]`.
2. Model responds with native tool calls (e.g., `localSearch`, `readFile`).
3. Each tool result becomes a `ToolMessage` appended to the growing messages array.
4. `localSearch` results get CiC ordering: the user's question (from L5 `originalUserPrompt`) is appended after the search payload via `ensureCiCOrderingWithQuestion`.
5. Loop repeats until model responds without tool calls (final answer).

### Token Efficiency Audit

**Verified efficient (no action needed):**

- L1+L2 prefix is stable and cacheable across turns — tool results never enter the system message.
- L3 uses smart references for artifacts already in L2 — no content duplication in the user message.
- L4 contains only displayText (via L5 extraction in `handleResponse`) — no context XML leakage.
- Chain runners extract L5 text from the envelope for `cleanedUserMessage` and `originalUserPrompt`, never using `processedText` (which contains L2+L3+L5 concatenated).

**Known inefficiencies (accepted tradeoffs):**

| Issue                                                                     | Severity | Tokens Wasted                                                   | Rationale                                                                                                                                                 |
| ------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CiC user-question repeated per `localSearch` tool call in agent loop      | LOW      | ~50 tokens x N searches                                         | Intentional — each `ToolMessage` is independent; the model needs the question for grounding across ReAct iterations                                       |
| L2 content may overlap with `localSearch` results                         | MEDIUM   | Variable (L2 has compacted preview, search has relevant chunks) | Structural limitation — search doesn't know about L2. Overlap is partial since L2 is compacted to structure+preview while search returns precision chunks |
| Legacy `processedText` stores L2+L3+L5 concatenation in MessageRepository | LOW      | 0 (not sent to LLM)                                             | Storage-only waste. Field is unused by envelope-based chain runners but persisted for backward compatibility                                              |

---

## Strengths

1. Envelope-first prompt construction is now consistent across all active chain runners.
2. L2 deduplication by artifact ID prevents linear repeated growth for repeated attachments.
3. Segment parsing is centralized and registry-driven, avoiding ad-hoc per-chain parsing logic.
4. Uniform tool placement removes previous cache-boundary ambiguity.
5. Memory-side assistant compaction reduces L4 bloat from tool payloads.
6. Regeneration path is now resilient to missing envelopes on loaded history.

---

## Known Gaps

### P0: Persistence Parity Is Still Incomplete

- Loaded chats do not rehydrate historical envelopes.
- Result: follow-up turns after load do not benefit from historical L2 library unless messages are individually reprocessed.

### P0: Non-Deterministic Fallback Segment IDs

- `appendParsedSegments()` uses `unparsed-${Date.now()}` when parsing fails.
- This breaks deterministic envelope identity and degrades cache behavior in edge cases.

### P1: Parser Still Depends on Regex Over Rendered XML

- `parseContextIntoSegments()` is significantly better than earlier local regex logic, but it still parses serialized XML strings rather than typed artifacts.
- Malformed/nested edge cases can still create parse misses and fallback behavior.

### P1: Compaction Semantics Need Stronger Invariants

- Two compaction modes exist (LLM summarization vs deterministic L2 preview compaction), but explicit invariants on what must remain verbatim are not enforced centrally.
- Non-recoverable context (e.g., selected text) needs stricter protection policies under heavy compaction.

### P1: L2 Mutation Tradeoff Not Formalized

- Current policy is ID-dedup + content overwrite.
- This is token-efficient, but mutable artifacts can invalidate long cached prefixes when content changes.
- The system needs an explicit "freshness vs cache stability" policy.

### P2: Envelope Metadata Is Underused

- `conversationId` is currently `null`.
- Missing stable conversation-level identity weakens observability and future caching strategies.

### P2: Documentation Drift Risk

- Prior docs contained stale statements (e.g., fallback-to-processedText behavior, on-load envelope reconstruction).
- This doc now reflects current code; future changes should keep this aligned.

---

## Improvement Roadmap

### Phase 1: Correctness and Determinism

1. Replace timestamp fallback IDs with deterministic IDs:
   - `unparsed:${sha256(content)}` (plus optional short prefix by source type).
2. Add envelope invariants checker (debug + tests):
   - no duplicate segment IDs inside a layer,
   - no L3 full-content block when ID exists in L2 unless explicitly marked override,
   - stable layer ordering and hash consistency.
3. Add robust parse-failure telemetry:
   - count parse misses,
   - log failing tag/source metadata,
   - capture hash-only samples in debug mode.

### Phase 2: Persistence Parity

1. Add lazy historical envelope reconstruction on first post-load send:
   - reprocess only prior user messages that have context references and missing envelopes,
   - skip URL/web-tab refetch by policy where needed.
2. Optional long-term path:
   - persist compact envelope metadata (or typed artifact snapshots) alongside markdown history for deterministic restoration.

### Phase 3: Compaction Safety and Policy

1. Define explicit compaction classes:
   - recoverable artifacts: can be summarized with re-fetch instructions,
   - non-recoverable artifacts: preserve verbatim or bounded extractive compaction only.
2. Add post-compaction validation:
   - each compacted artifact must retain deterministic source identity and recoverability hints.
3. Make compaction strategy configurable by chain type and context source type.

### Phase 4: Cache Optimization

1. Split L1 into stable and mutable subsections (for example:
   - static system contract,
   - user memory and project overlays) to reduce unnecessary prefix invalidation.
2. Introduce provider-aware cache hooks (opt-in):
   - Anthropic `cache_control`,
   - Gemini explicit cache primitives,
   - keep model-agnostic baseline unchanged.
3. Add per-turn prefix hash diff reporting:
   - `L1 hash`, `L2 hash`, combined prefix hash,
   - classify why prefix changed (settings, context attach, file change, memory update).

### Phase 5: Typed Artifact Pipeline (Strategic)

Move from "render XML then parse XML" to a typed artifact graph:

- `ContextProcessor` emits typed artifacts directly (`artifactKey`, `sourceType`, `recoverable`, `payload`, `contentHash`).
- Envelope stores typed segments as canonical source-of-truth.
- XML remains a rendering format, not parsing substrate.

This is the highest-leverage change for long-term reproducibility and parser robustness.

### Phase 6: Context Envelope Integration Test Suite

Build a comprehensive test suite that validates multi-turn envelope behavior without requiring manual UI testing:

1. **Multi-turn envelope simulation tests**:

   - Simulate 3+ turn conversations with various artifact combinations (notes, URLs, YouTube, PDFs, selected text).
   - Assert correct L2 promotion, dedup, smart referencing, and compaction at each turn.
   - Validate that L4 memory contains only displayText (no context XML leakage).

2. **Layer composition snapshot tests**:

   - For canonical conversation trajectories, snapshot the full `[L1, L2, L3, L4, L5]` payload sent to the LLM.
   - Detect unintended regressions in layer ordering, dedup behavior, or content placement.

3. **Round-trip persistence tests**:

   - Save a conversation to markdown, reload it, send a follow-up turn.
   - Assert that lazy reprocessing reconstructs envelopes and L2 correctly.

4. **Edge-case regression tests**:

   - Same artifact attached across 5+ turns (dedup stability).
   - Artifact added, removed, re-added (L2 cumulative behavior).
   - Multiple `selected_text` blocks in same turn (unique ID generation).
   - Malformed XML blocks (graceful fallback, no silent data loss).
   - Very large context triggering compaction (invariants preserved).

5. **Property-based tests** (optional, aspirational):
   - Generate random artifact sequences and assert envelope invariants hold:
     no duplicate segment IDs within a layer, L3 references only exist if ID is in L2,
     L4 never contains XML block tags.

This suite replaces the need for manual multi-turn chat testing in the UI and provides a safety net for all future envelope changes.

---

## Testing and Observability

### Core Tests to Add/Strengthen

1. Post-load follow-up turn should rebuild/rehydrate envelope behavior deterministically.
2. Deterministic fallback ID behavior (no wall-clock dependence).
3. Property tests for parser with malformed/nested blocks.
4. Compaction invariants:
   - non-recoverable blocks never become unrecoverable summaries without explicit guardrails.
5. Prefix-hash stability tests across common conversation trajectories.

### Runtime Metrics (Debug Mode)

- Envelope build time by phase (L2 build, context processing, compaction, render).
- Segment counts per layer and dedup ratio.
- Prefix hash change reason classification.
- Parse-failure count and compacted-context proportion.

---

## References

### Primary Implementation Files

- `src/core/ChatManager.ts`
- `src/core/ContextManager.ts`
- `src/context/PromptContextTypes.ts`
- `src/context/PromptContextEngine.ts`
- `src/context/parseContextSegments.ts`
- `src/context/LayerToMessagesConverter.ts`
- `src/core/MessageRepository.ts`
- `src/core/ChatPersistenceManager.ts`
- `src/LLMProviders/chainRunner/LLMChainRunner.ts`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`

### Related Docs

- `docs/MESSAGE_ARCHITECTURE.md`
- `docs/TOOLS.md`
- `docs/NATIVE_TOOL_CALLING_MIGRATION.md`
- `docs/TECHDEBT.md`
- `TODO.md`
