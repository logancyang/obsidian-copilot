# Token Budget Enforcement

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current Compaction Architecture](#current-compaction-architecture)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Fix Plan](#fix-plan)
5. [References](#references)

---

## Problem Statement

The model proxy receives requests with token counts far exceeding the model's context window (e.g., 2.7M tokens sent to a 1M-token Vertex AI model). The plugin's auto-compaction system was expected to prevent this but fails because it only guards a subset of the total payload.

```
ContextWindowExceededError: The input token count (2769478)
exceeds the maximum number of tokens allowed (1048575).
```

---

## Current Compaction Architecture

There are **three separate compaction mechanisms** in the plugin. None of them enforce a total token budget against the model's actual context window.

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

### The Unprotected Path: L4 Chat History

The critical gap is that **chat history (L4) is loaded and injected with no token budget**.

`loadAndAddChatHistory()` in `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts:229-248`:

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

The `BufferWindowMemory` is configured with `k = contextTurns * 2` (default: `15 * 2 = 30` messages). While the ChatHistoryCompactor trims tool results at save time, it does not limit:

- User messages in history (which are just `displayText`, but can still be long)
- Assistant response text outside of tool results
- The cumulative size of all 30 messages

### All Chain Runners Are Affected

All four chain runners call `loadAndAddChatHistory()` without any token budget:

| Runner                     | File                                                         | Line |
| -------------------------- | ------------------------------------------------------------ | ---- |
| LLMChainRunner             | `src/LLMProviders/chainRunner/LLMChainRunner.ts`             | 45   |
| CopilotPlusChainRunner     | `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts`     | 606  |
| AutonomousAgentChainRunner | `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts` | 597  |
| VaultQAChainRunner         | `src/LLMProviders/chainRunner/VaultQAChainRunner.ts`         | 191  |

### How 2.7M Tokens Happen

In a typical agent conversation with context-heavy turns:

```
L1 (system + tool guidelines):    ~10k tokens
L2 (previous context, compacted):  ~20k tokens
L3 (current turn context):         ~50k tokens
L4 (15 turns of chat history):   ~2,500k tokens  ← THE CULPRIT
L5 (user message):                  ~2k tokens
─────────────────────────────────────────────────
TOTAL:                            ~2,582k tokens  → sent to 1M model
```

L4 can grow this large because:

1. Agent-mode turns generate long assistant responses with tool call chains
2. While tool _results_ are compacted at save time, the **assistant's reasoning text** between tool calls is stored verbatim
3. With 15 turns of agent conversation, this easily reaches millions of tokens
4. The ContextCompactor threshold check (L2+L3 only) never sees L4

### Secondary Issue: No Model Context Window Awareness

The plugin has no mechanism to query or enforce the model's actual context window size. The `autoCompactThreshold` setting (default 128k tokens) is a user-configured heuristic that:

- Has no relation to the actual model's context window
- Only applies to L2+L3, not the full payload
- Cannot prevent overflow from L4

---

## Fix Plan

### Guiding Principles

1. **Single enforcement point**: Token budget must be checked where all layers are assembled, not scattered across individual compactors.
2. **Graceful degradation**: When over budget, drop the least-valuable content first (oldest history turns), then compact further if needed.
3. **Backwards compatible**: Existing compaction systems remain; this adds a final safety net.
4. **No LLM calls in the hot path**: Budget enforcement should use fast char-based estimation, not LLM summarization.

### Phase 1: Token Budget Guard at Message Assembly

**Goal**: Prevent over-budget payloads from ever reaching the LLM.

#### 1.1 Add `getModelContextWindow()` to ChatModelManager

Add a method that returns the current model's context window size in tokens. This can start with a hardcoded lookup table for known models (OpenAI, Anthropic, Google, etc.) and fall back to a conservative default (e.g., 128k tokens). Over time, this can be enhanced with dynamic model metadata from provider APIs.

**File**: `src/LLMProviders/chatModelManager.ts`

#### 1.2 Add `estimateTokenCount()` utility

A fast char-based token estimator (chars / 4) that works on the assembled message array. This already partially exists in the codebase (the `* 4` pattern in ContextManager) but should be extracted into a shared utility.

**File**: `src/utils/tokenEstimation.ts` (new)

#### 1.3 Add `enforceTokenBudget()` to `chatHistoryUtils.ts`

Modify `loadAndAddChatHistory()` (or add a wrapper) that:

1. Estimates the token count of the assembled system message + current user message (L1+L2+L3+L5)
2. Calculates remaining budget: `modelContextWindow - reservedForOutput - (L1+L2+L3+L5)`
3. Loads chat history messages and drops oldest turns first until within budget
4. Logs a warning when turns are dropped

```
Token Budget Allocation:
  modelContextWindow (e.g., 1,048,575)
  - reservedForOutput (~4,096 for response generation)
  - L1+L2 system message size
  - L3+L5 user message size
  = remaining budget for L4 chat history
```

**File**: `src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts`

#### 1.4 Update all chain runners

Each of the four chain runners calls `loadAndAddChatHistory()`. Update these call sites to pass the model context window and the already-assembled non-L4 messages, so the budget can be calculated.

**Files**:

- `src/LLMProviders/chainRunner/LLMChainRunner.ts`
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`
- `src/LLMProviders/chainRunner/VaultQAChainRunner.ts`

### Phase 2: Smarter History Trimming

**Goal**: When budget is tight, trim intelligently rather than just dropping oldest turns.

#### 2.1 Prioritized trimming strategy

When over budget, apply in order:

1. **Drop oldest complete turns** (user+assistant pairs) from L4
2. **Truncate remaining long assistant responses** in L4 (keep first N chars)
3. If _still_ over budget after L4 is empty, **re-compact L2+L3** with tighter thresholds
4. If _still_ over budget (single turn with massive context), **warn user** and proceed with truncated context

#### 2.2 Agent-mode special handling

Agent-mode assistant responses contain interleaved reasoning + tool calls. When trimming these:

- Prefer keeping the **final answer** portion (last text block)
- Drop intermediate tool call/result blocks first
- Keep the first tool call for context on what approach was taken

### Phase 3: Settings & Observability

#### 3.1 Surface token usage to UI

Add a debug/info display showing:

- Estimated tokens per layer (L1, L2, L3, L4, L5)
- Model context window
- Whether any trimming occurred
- How many history turns were dropped

This helps users understand why responses might miss context from earlier turns.

#### 3.2 Relate `autoCompactThreshold` to model context window

Currently `autoCompactThreshold` is an arbitrary number (default 128k). Consider:

- Making it a percentage of the model's context window (e.g., 60%)
- Auto-adjusting when the user switches models
- Deprecating it in favor of the budget enforcement system

### Implementation Order

| Step | Description                               | Files Changed        | Risk   |
| ---- | ----------------------------------------- | -------------------- | ------ |
| 1.1  | `getModelContextWindow()`                 | chatModelManager.ts  | Low    |
| 1.2  | `estimateTokenCount()` utility            | new file             | Low    |
| 1.3  | `enforceTokenBudget()` in history loading | chatHistoryUtils.ts  | Medium |
| 1.4  | Update chain runner call sites            | 4 chain runner files | Medium |
| 2.1  | Prioritized trimming                      | chatHistoryUtils.ts  | Medium |
| 3.1  | Token usage debug display                 | UI components        | Low    |

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
