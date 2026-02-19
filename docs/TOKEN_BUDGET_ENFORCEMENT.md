# Token Budget Enforcement

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current Compaction Architecture](#current-compaction-architecture)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Fix Plan](#fix-plan)
5. [References](#references)

---

## Problem Statement

The model proxy receives requests with token counts far exceeding the model's context window (e.g., 2.7M tokens sent to a 1M-token Vertex AI model). The plugin's auto-compaction system was expected to prevent this but fails because **no compaction mechanism checks the total assembled payload** — each compactor guards only its own subset.

```
ContextWindowExceededError: The input token count (2769478)
exceeds the maximum number of tokens allowed (1048575).
```

---

## Current Compaction Architecture

There are **three separate compaction mechanisms** in the plugin. None of them enforce a total token budget against the `autoCompactThreshold` setting.

### 1. Turn-Time Context Compaction (ContextCompactor)

**Where**: `ContextManager.processMessageContext()` (`src/core/ContextManager.ts:231-258`)
**When**: Every time a user message is processed, before the envelope is built.
**What it covers**: L2 (previous turn context) + L3 (current turn context) combined.
**What it does NOT cover**: L1 (system prompt), L4 (chat history), L5 (user message).

```
Trigger condition:
  (processedUserMessage + contextPortion).length > autoCompactThreshold * 4

Where:
  autoCompactThreshold = settings.autoCompactThreshold (default: 128,000 tokens)
  charThreshold = 128,000 * 4 = 512,000 chars
```

When triggered, `ContextCompactor.compact()` performs map-reduce LLM summarization on individual XML blocks larger than 50k chars. The user message itself is never compacted.

**Key limitation**: This threshold check measures `processedUserMessage + contextPortion` (which is L5 + L2 + L3). It does NOT include:

- L1 (system prompt) — typically 2-10k tokens
- L4 (chat history) — potentially **hundreds of thousands of tokens**

### 2. L2 Carry-Forward Compaction (L2ContextCompactor)

**Where**: `ContextManager.compactSegmentForL2()` (`src/core/ContextManager.ts:706-733`)
**When**: When previous turn L3 segments are promoted into L2 for the next turn.
**What it does**: Deterministic structure+preview compression (headings + truncated sections). No LLM calls.

This is a **per-segment** operation that reduces each context artifact to a `<prior_context>` block with ~500 chars per section. This prevents L2 from growing unbounded as turns accumulate.

### 3. Chat History Compaction (ChatHistoryCompactor)

**Where**: `MemoryManager.saveContext()` (`src/LLMProviders/memoryManager.ts:61-72`)
**When**: After each assistant response, at memory save time.
**What it does**: Compacts tool results (`localSearch`, `readNote`, etc.) in assistant responses before saving to `BufferWindowMemory`.

This compacts **only the tool-result portions** of assistant messages. The rest of the assistant text and all user messages are stored verbatim.

### Summary: What Each System Protects

| Compaction System                  | Scope                              | Token-Aware?                    | Covers Full Payload?   |
| ---------------------------------- | ---------------------------------- | ------------------------------- | ---------------------- |
| ContextCompactor (turn-time)       | L2 + L3 context XML blocks         | Threshold-based (char estimate) | No — misses L1, L4, L5 |
| L2ContextCompactor (carry-forward) | Individual L2 segments             | No — fixed per-segment          | No — per-segment only  |
| ChatHistoryCompactor (save-time)   | Tool results in assistant messages | No — fixed size                 | No — only tool results |

---

## Root Cause Analysis

### The Core Problem: No Total Payload Budget

The critical gap is **systemic**: no compaction mechanism checks the total assembled payload (L1+L2+L3+L4+L5) against any budget. Each compactor guards only its own subset, and no final safety net exists.

### What L4 Actually Contains

L4 (chat history) is often assumed to be the main token consumer, but investigation shows it is relatively well-controlled:

- **User messages in L4** = bare L5 text only (no context XML). `BaseChainRunner.handleResponse()` extracts `l5Text` from the envelope and saves only that to memory.
- **Assistant responses in L4** = compacted at save time by `ChatHistoryCompactor`, which strips tool result XML (`localSearch`, `readNote`, `note_context`, etc.).
- **Agent-mode responses**: `AutonomousAgentChainRunner` saves only `loopResult.finalResponse` (the final answer), NOT the full reasoning/tool-call chain.

L4 does grow with conversation length, but it is not unbounded — `BufferWindowMemory` limits it to `k = contextTurns * 2` messages (default: 30), and both user and assistant sides are relatively compact.

### The Real Culprits: L1 and Unchecked Layer Accumulation

The overflow happens because **multiple layers accumulate without any shared budget**:

#### L1: Project Context Is Never Budgeted

In Projects mode, `ChatManager.getSystemPromptForMessage()` concatenates all project files, web content, and YouTube transcripts into a `<project_context>` block inside L1. This can easily reach **hundreds of thousands of tokens** for large projects.

L1 is **never compacted by any system** — no compactor even sees it.

#### Compaction Threshold Is Blind to L1

`ContextManager.processMessageContext()` uses a hardcoded `PROJECT_COMPACT_THRESHOLD = 1,000,000` tokens for Projects mode compaction. This threshold checks only L2+L3 size — it is completely blind to L1 (project context) size. It is set as if L2+L3 is the _entire_ budget, when in reality L1 may have already consumed most of the available context window.

For non-project chains, `autoCompactThreshold` (default 128k) is used, but it also only checks L2+L3.

#### L4: No Budget Awareness

`loadAndAddChatHistory()` loads all history messages without checking how much token budget remains after L1+L2+L3+L5 are assembled:

```typescript
export async function loadAndAddChatHistory(
  memory: any,
  messages: Array<{ role: string; content: any }>
): Promise<ProcessedMessage[]> {
  const memoryVariables = await memory.loadMemoryVariables({});
  const rawHistory = memoryVariables.history || [];
  // ... processes and adds ALL history messages with NO size check
}
```

### How 2.7M Tokens Happen

In a Projects-mode conversation:

```
L1 (system + project_context):   ~500k tokens  ← UNBUDGETED, never compacted
L2 (previous context, compacted):  ~20k tokens
L3 (current turn context):         ~50k tokens
                                   ─────────
  ContextCompactor checks L2+L3:    70k < 1,000k threshold → NO compaction triggered
                                   (threshold is blind to 500k in L1)

L4 (15 turns of chat history):    ~200k tokens  ← loaded with no remaining budget check
L5 (user message):                   ~2k tokens
─────────────────────────────────────────────────
TOTAL:                             ~772k tokens  → may exceed model's context window
```

In extreme cases (large projects + long conversations + heavy context attachments), totals can reach 2M+ tokens.

### All Chain Runners Are Affected

All chain runners call `loadAndAddChatHistory()` without any token budget:

| Runner                     | File                                                         | Line |
| -------------------------- | ------------------------------------------------------------ | ---- |
| LLMChainRunner             | `src/LLMProviders/chainRunner/LLMChainRunner.ts`             | 45   |
| CopilotPlusChainRunner     | `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts`     | 606  |
| AutonomousAgentChainRunner | `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts` | 597  |
| VaultQAChainRunner         | `src/LLMProviders/chainRunner/VaultQAChainRunner.ts`         | 191  |

### The `contextTurns` Setting Is a Poor Proxy

`BufferWindowMemory` is configured with `k = contextTurns * 2` (default: 30 messages). This is a crude count-based limit that:

- Has no relation to actual token consumption
- Cannot adapt to varying message sizes
- Provides no guarantees about total payload size

A token-based budget for L4 makes `contextTurns` redundant.

---

## Fix Plan

### Guiding Principles

1. **Model-agnostic**: The plugin supports many LLM providers. No model-specific context window logic. Use `autoCompactThreshold` (user-configurable) as the single total budget.
2. **Single enforcement point**: Token budget must be checked where all layers are assembled, not scattered across individual compactors.
3. **History guarantee**: The LLM must always see at least some recent chat history to resume conversation context, even when L1+L2+L3 consume most of the budget.
4. **Graceful degradation**: When over budget, drop the least-valuable content first (oldest history turns), then compact further if needed.
5. **Backwards compatible**: Existing compaction systems remain; this adds a final safety net.
6. **No LLM calls in the hot path**: Budget enforcement should use fast char-based estimation (chars / 4), not LLM summarization.

### Phase 1: Token Budget Guard (Critical Fix)

**Goal**: Prevent over-budget payloads from ever reaching the LLM.

#### 1.1 Make ContextManager L1-Aware

Currently `ContextManager.processMessageContext()` checks `(L2+L3).length > threshold * 4` where threshold is either `autoCompactThreshold` or `PROJECT_COMPACT_THRESHOLD`. Both are blind to L1 size.

**Fix**: The compaction threshold for L2+L3 must account for L1:

```
effectiveThreshold = autoCompactThreshold - estimateTokens(L1)
```

This ensures that when L1 is large (e.g., Projects mode with many files), L2+L3 compaction triggers earlier, leaving room for L4 and L5.

**Kill `PROJECT_COMPACT_THRESHOLD`** — it is a hardcoded 1M value that pretends L1 doesn't exist. Replace with the same `autoCompactThreshold - L1` formula for all chain types.

**File**: `src/core/ContextManager.ts`

#### 1.2 Add Token Budget to `loadAndAddChatHistory()`

Add an optional `tokenBudget` parameter to `loadAndAddChatHistory()`. When provided:

1. Load all history messages from `BufferWindowMemory`
2. Estimate token count of each message (chars / 4)
3. Drop oldest complete turns (user+assistant pairs) until cumulative total fits within budget
4. Always keep at least the most recent turn (history guarantee)
5. Log a warning when turns are dropped

```
Token Budget Allocation:
  autoCompactThreshold (e.g., 128,000 tokens)
  - estimateTokens(L1)   system prompt + project context
  - estimateTokens(L2)   previous context library
  - estimateTokens(L3)   current turn context
  - estimateTokens(L5)   user message
  - reservedForOutput    (~4,096 for response generation)
  = remaining budget for L4 chat history
```

**File**: `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts`

#### 1.3 Update All Chain Runners

Each chain runner calls `loadAndAddChatHistory()`. Update call sites to:

1. Calculate the token size of already-assembled non-L4 messages (L1+L2+L3+L5)
2. Compute `historyBudget = autoCompactThreshold - nonL4Tokens - outputReserve`
3. Pass `historyBudget` to `loadAndAddChatHistory()`

**Files**:

- `src/LLMProviders/chainRunner/LLMChainRunner.ts`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts`

#### 1.4 Deprecate `contextTurns` Setting

Token-based budget trimming makes the count-based `contextTurns` setting redundant.

- Replace `BufferWindowMemory.k = contextTurns * 2` with a generous internal constant (e.g., `k = 100`)
- The token budget in step 1.2 handles the actual trimming
- Remove the "Conversation turns in context" slider from `ModelSettings.tsx`

**Files**:

- `src/LLMProviders/memoryManager.ts`
- `src/settings/v2/components/ModelSettings.tsx`

### Phase 2: Smarter History Trimming (Enhancement)

**Goal**: When budget is tight, trim intelligently rather than just dropping oldest turns.

#### 2.1 Prioritized trimming strategy

When over budget, apply in order:

1. **Drop oldest complete turns** (user+assistant pairs) from L4
2. **Truncate remaining long assistant responses** in L4 (keep first N chars)
3. If _still_ over budget after L4 is minimized, **warn user** and proceed — the LLM will still see the most recent turn

### Phase 3: Observability (Enhancement)

#### 3.1 Surface token usage to UI

Add a debug/info display showing:

- Estimated tokens per layer (L1, L2, L3, L4, L5)
- Total vs. `autoCompactThreshold`
- Whether any history turns were dropped

This helps users understand why responses might miss context from earlier turns.

### Implementation Order

| Step | Description                               | Files Changed                   | Risk   |
| ---- | ----------------------------------------- | ------------------------------- | ------ |
| 1.1  | L1-aware compaction threshold             | ContextManager.ts               | Medium |
| 1.2  | Token budget in `loadAndAddChatHistory()` | chatHistoryUtils.ts             | Medium |
| 1.3  | Update chain runner call sites            | 4 chain runner files            | Medium |
| 1.4  | Deprecate `contextTurns`                  | memoryManager.ts, ModelSettings | Low    |
| 2.1  | Prioritized trimming                      | chatHistoryUtils.ts             | Low    |
| 3.1  | Token usage debug display                 | UI components                   | Low    |

Phase 1 (steps 1.1-1.4) is the **critical fix** that prevents the overflow. Phases 2-3 are improvements.

---

## References

### Source Files

| File                                                         | Role                                            |
| ------------------------------------------------------------ | ----------------------------------------------- |
| `src/core/ContextManager.ts`                                 | Turn-time compaction trigger (L2+L3)            |
| `src/core/ContextCompactor.ts`                               | Map-reduce LLM summarization                    |
| `src/context/L2ContextCompactor.ts`                          | Deterministic L2 segment compaction             |
| `src/context/ChatHistoryCompactor.ts`                        | Tool result compaction at save time             |
| `src/LLMProviders/memoryManager.ts`                          | Memory save with compaction                     |
| `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts`     | Chat history loading (no budget)                |
| `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts` | Agent message assembly                          |
| `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts`     | CopilotPlus message assembly                    |
| `src/LLMProviders/chainRunner/LLMChainRunner.ts`             | Basic LLM message assembly                      |
| `src/LLMProviders/chainRunner/VaultQAChainRunner.ts`         | VaultQA message assembly                        |
| `src/LLMProviders/chatModelManager.ts`                       | Chat model management                           |
| `src/constants.ts`                                           | Default settings (autoCompactThreshold: 128000) |

### Related Docs

- [CONTEXT_ENGINEERING.md](./CONTEXT_ENGINEERING.md) — L1-L5 layer architecture
- [MESSAGE_ARCHITECTURE.md](./MESSAGE_ARCHITECTURE.md) — Message flow and storage
- [TECHDEBT.md](./TECHDEBT.md) — Known technical debt
