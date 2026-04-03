# Compactor Refinement: Industry Comparison & Improvement Plan

## 1. Executive Summary

Our current compaction system uses three separate compactors with different strategies (LLM summarization, deterministic truncation, tool result compaction). This design doc compares our approach against industry state-of-the-art (OpenAI Codex, Claude Code CLI, Google ADK, JetBrains, Amp) and identifies concrete improvements to reduce information loss, improve compression ratios, and enable longer effective conversations.

## 2. Current Architecture

### 2.1 Three Compactors

| Compactor | File | Strategy | When Triggered |
|-----------|------|----------|----------------|
| **ContextCompactor** | `src/core/ContextCompactor.ts` | LLM-based map-reduce summarization | Auto: context exceeds `autoCompactThreshold` (tokens * 4 chars) |
| **L2ContextCompactor** | `src/context/L2ContextCompactor.ts` | Deterministic structure extraction (headings + preview) | Every turn: when L3 content promotes to L2 |
| **ChatHistoryCompactor** | `src/context/ChatHistoryCompactor.ts` | Deterministic tool result truncation | Every turn: at `MemoryManager.saveContext()` time |

### 2.2 Current Flow

```
User sends message
    |
    v
ContextManager.processContext()
    |
    +--> Build L2 from previous turns
    |    (L2ContextCompactor: compactXmlBlock per block)
    |
    +--> Build L3 current turn context
    |    (notes, URLs, web tabs, etc.)
    |
    +--> If total > charThreshold:
    |    ContextCompactor.compact() on context portion only
    |    (LLM map-reduce: parse XML -> summarize large items -> rebuild)
    |
    v
LLM processes message
    |
    v
MemoryManager.saveContext()
    (ChatHistoryCompactor: compact tool results in assistant output)
```

### 2.3 Current Limitations

1. **No conversation-level compaction** - We only compact attached context (notes, URLs) and tool results. We never compact the conversation history itself (user messages + assistant responses across turns).

2. **LLM summarization loses exact details** - The ContextCompactor uses LLM summarization which paraphrases content, losing exact file paths, line numbers, error codes, and configuration values.

3. **No sliding window / progressive compaction** - Each compaction is a one-shot operation. There's no incremental approach that compounds over multiple turns.

4. **50k char minimum is too coarse** - The `MIN_ITEM_SIZE = 50000` threshold in ContextCompactor means items between 5k-50k chars are never summarized, even when there are many of them causing aggregate bloat.

5. **No observation masking** - Tool outputs (localSearch, readNote) retain full content in the current turn. JetBrains showed that replacing stale tool outputs with placeholders while preserving the reasoning trace achieves similar quality with less context usage.

6. **No differentiated compaction by content type** - All content gets the same treatment. Code, prose, structured data, and transcripts have very different compressibility and information density.

7. **L2 compaction is too aggressive** - `compactBySection()` keeps only 500 chars per section with max 20 sections. For a detailed research note, this loses significant nuance.

8. **No user-facing `/compact` command** - Unlike Claude Code CLI, Codex CLI, and OpenCode, users cannot manually trigger compaction or provide custom compaction instructions.

9. **Staleness detection removed** - The codebase notes that mtime-based staleness detection was intentionally removed for simplicity, but this means compacted content can become outdated without the user knowing.

10. **No compaction quality metrics** - We don't track or surface how much information was lost, making it impossible to tune thresholds empirically.

## 3. Industry Comparison

### 3.1 OpenAI Codex

**Approach**: Server-side opaque encrypted compaction via `/responses/compact` endpoint.

| Aspect | Codex | Our Implementation |
|--------|-------|--------------------|
| Compression ratio | 99.3% | ~60-80% (estimated) |
| Human-readable | No (encrypted) | Yes |
| Hallucination risk | Unknown (opaque) | Yes (LLM summarization) |
| Conversation compaction | Yes (full history) | No (context only) |
| User control | `/compact` command | None |
| Incremental | Yes (drop items before latest compaction) | No |
| Vendor lock-in | Yes (OpenAI only) | No |

**Key insight from Codex**: The "drop everything before the last compaction item" pattern is elegant. After compaction, the compacted item carries all necessary prior state. Subsequent API calls only need: `[compaction_item, new_messages_after_compaction]`. This prevents unbounded context growth.

**Applicable to us**: We partially implement this in `buildL2ContextFromPreviousTurns()` where we find `mostRecentCompactedIndex` and only include L3 content from that point forward. But we don't apply this to conversation history (user/assistant message pairs).

### 3.2 Claude Code CLI

**Approach**: LLM-based summarization generating structured summaries (7k-12k chars).

| Aspect | Claude Code CLI | Our Implementation |
|--------|----------------|--------------------|
| Trigger | Auto at ~95% capacity, manual `/compact` | Auto at configurable token threshold |
| Summary format | Structured (tasks done, files modified, decisions, pending) | Generic prose summary |
| Custom instructions | Yes (user can guide what to preserve) | No |
| Session continuity | New session with summary as initial context | Same session, compacted in-place |
| Known issues | Cumulative loss across multiple compactions | Same issue, undocumented |

**Key insight from Claude Code**: The structured summary format (analysis completed, files modified, key decisions, pending tasks) is far more useful for continuity than a generic prose summary. It treats compaction as a "session handoff" rather than just compression.

**Applicable to us**: Our ContextCompactor prompt is generic ("Summarize preserving key concepts"). A structured prompt tailored to the conversation type (Q&A, agent tasks, research) would preserve more actionable information.

### 3.3 Google ADK

**Approach**: Sliding window with configurable interval and overlap.

| Aspect | Google ADK | Our Implementation |
|--------|-----------|-------------------|
| Strategy | Sliding window with overlap | One-shot when threshold crossed |
| Granularity | Per-event (tool call, response) | Per-context-item (XML block) |
| Overlap | Configurable overlap_size | None |
| Progressive | Yes (compaction builds on previous compaction) | No |

**Key insight from ADK**: The sliding window with overlap ensures that compaction is incremental and never loses the most recent context. The overlap parameter controls how much of the previous compaction window is re-included, preventing cliff-edge information loss.

**Applicable to us**: Instead of waiting until the context is huge and doing a big-bang compaction, we could compact older turns progressively. Turn N-5 gets heavily compacted, N-3 moderately, N-1 stays verbatim.

### 3.4 JetBrains (Observation Masking)

**Approach**: Replace stale tool outputs with placeholders while preserving tool calls.

| Aspect | JetBrains | Our Implementation |
|--------|----------|-------------------|
| Strategy | Mask observations, keep reasoning trace | Truncate tool results with section preview |
| Hallucination risk | Zero (placeholder, not paraphrase) | Low (truncation) but lossy |
| Key finding | "Reasoning trace matters more than raw data" | Not implemented |

**Key insight**: The reasoning trace (what the agent decided to do and why) is more valuable for continuation than the raw data it operated on. A search result of 50 documents can be replaced with `[localSearch: 12 results for "auth middleware" - see tool call above]` because the assistant's response already synthesized the key findings.

**Applicable to us**: Our `ChatHistoryCompactor` already does a version of this for tool results, but it preserves section previews rather than just placeholders. We could be more aggressive for older turns while keeping recent turns' tool outputs intact.

### 3.5 Amp (Sourcegraph)

**Approach**: No automatic compaction. Manual "handoff" extracts relevant information for a new thread.

| Aspect | Amp | Our Implementation |
|--------|-----|-------------------|
| Philosophy | Short, focused conversations | Long conversations with compaction |
| Strategy | Handoff to new thread | In-place compaction |
| User control | Full (fork, edit, restore) | None |

**Key insight**: Amp argues that "everything in the context window influences output" and that stale context (even summarized) can degrade quality. Their approach is to start fresh with only the relevant extracted context, rather than carrying forward compressed history.

**Applicable to us**: This is relevant for our Project mode. When a project chat gets long, offering a "handoff" that creates a new chat with extracted state could be more effective than repeated compaction.

### 3.6 Factory.ai Benchmark Results

Factory's evaluation provides empirical data:

| Approach | Accuracy | Multi-session Retention | Compression |
|----------|----------|------------------------|-------------|
| LLM Summarization | 3.74-4.04/5 | 37% | High |
| OpenAI Opaque | 3.35/5 | N/A | 99.3% |
| Verbatim Compaction | 98% verbatim accuracy | N/A | 50-70% |

**Critical finding**: Multi-session information retention for LLM summarization was only **37%**. This means after compaction, nearly two-thirds of specific information is lost. This directly impacts our ContextCompactor which uses LLM summarization.

## 4. Proposed Improvements

### 4.1 Priority 1: Tiered Compaction Strategy (Replace single-strategy approach)

**Problem**: We use one strategy (LLM summarization) for all compaction. Different content at different ages needs different treatment.

**Proposal**: Implement a 3-tier compaction pipeline:

```
Tier 0 (Current Turn):     Verbatim - no compaction
Tier 1 (Recent, N-1..N-3): Observation masking - replace tool outputs with
                            placeholders, keep reasoning and user messages
Tier 2 (Older, N-4+):      Structured summary - LLM summarization with
                            structured format (not generic prose)
```

This mirrors the "recency gradient" used by most successful implementations.

**Implementation sketch**:
- Modify `buildL2ContextFromPreviousTurns()` to apply different compaction levels based on message age
- Tier 1: New `maskToolObservations()` function that replaces tool content with `[Tool output: N results - see assistant response below]`
- Tier 2: Enhanced ContextCompactor with structured summary prompt

### 4.2 Priority 2: Structured Summary Format

**Problem**: Our ContextCompactor prompt is generic: "Summarize preserving key concepts, facts, names, dates, technical details."

**Proposal**: Use a structured summary format inspired by Claude Code CLI:

```
## Compaction Summary

### Context Analyzed
- [list of notes/URLs/documents with paths]

### Key Information Extracted
- [bullet points of critical facts, decisions, code snippets]

### File Paths & References
- [exact paths, line numbers, error codes - verbatim, not paraphrased]

### Open Questions / Pending
- [anything the user asked that wasn't fully resolved]
```

**Rationale**: Factory.ai's benchmark showed 37% multi-session retention for generic summarization. Structured formats force the LLM to preserve specific categories of information that generic summarization tends to drop (exact paths, error codes, configuration values).

### 4.3 Priority 3: Progressive/Sliding Window Compaction

**Problem**: We do a single big compaction when the threshold is crossed. This is jarring and lossy.

**Proposal**: Implement sliding window compaction inspired by Google ADK:

- Track turn count and total context size
- At each turn, check if oldest non-compacted turns can be compacted
- Compact in windows of 3-5 turns, with 1-turn overlap
- Each window gets Tier 2 summarization
- Most recent 3 turns stay at Tier 0/1

**Benefits**:
- Smoother context management (no sudden quality cliff)
- Smaller per-compaction batches = better LLM summarization quality
- Overlap prevents information loss at window boundaries

### 4.4 Priority 4: User-Facing `/compact` Command

**Problem**: Users have no way to manually trigger compaction or guide what to preserve.

**Proposal**: Add a `/compact` slash command that:
1. Shows current context usage (tokens used / total)
2. Triggers compaction with optional user instructions
3. Reports what was compacted and compression ratio

```
User: /compact focus on the authentication implementation decisions
→ "Compacted 45k tokens → 8k tokens (82% reduction).
   Preserved: auth decisions, file paths, pending tasks."
```

### 4.5 Priority 5: Observation Masking for Tool Results

**Problem**: Tool outputs (localSearch with 12 documents, readNote with full file content) consume massive context but their value decreases rapidly after the assistant has processed them.

**Proposal**: In `ChatHistoryCompactor`, implement JetBrains-style observation masking:

**Current behavior** (tool result in memory after 2 turns):
```
<prior_context source="localSearch" type="note">
[3 search results - use localSearch to re-query]
1. [[Note 1]] (notes/note1.md)
   First document content. First document content...
2. [[Note 2]] (notes/note2.md)
   Second document content...
</prior_context>
```

**Proposed behavior** (after 2+ turns):
```
[Prior tool output: localSearch returned 3 results including [[Note 1]], [[Note 2]], [[Note 3]].
 Assistant synthesized findings in response below. Re-run localSearch to access full content.]
```

**Rationale**: The assistant's response already contains the synthesized findings from the tool output. Keeping the raw output is redundant. Only the reference list (which notes were found) needs to persist for potential re-fetching.

### 4.6 Priority 6: Content-Type-Aware Compaction

**Problem**: All content gets the same `compactBySection()` treatment. But code, prose, and structured data compress very differently.

**Proposal**: Differentiate compaction by content type:

| Content Type | Compaction Strategy |
|-------------|-------------------|
| **Markdown prose** | Section headings + preview (current approach, works well) |
| **Code blocks** | Keep function signatures + first/last 3 lines per function |
| **Tables/CSV** | Keep headers + first 3 rows + row count |
| **YouTube transcripts** | Timestamp-based chunking with topic extraction |
| **PDF content** | Page-based chunking with section headers |

### 4.7 Priority 7: Compaction Metrics & Observability

**Problem**: We log compression ratios but don't track information loss or expose metrics to users.

**Proposal**:
- Track `compactionCount` per conversation (how many times compacted)
- Warn users when `compactionCount > 3` (diminishing returns, per Codex CLI docs)
- Show context usage indicator in chat UI (like Codex's context bar)
- Log structured metrics: `{ turn, contextSize, compactionTier, compressionRatio, itemsDropped }`

## 5. Implementation Phases

### Phase 1: Quick Wins (Low effort, high impact)
- [ ] Add `/compact` command with context usage display
- [ ] Improve ContextCompactor prompt to use structured format
- [ ] Add compaction count tracking and warning

### Phase 2: Observation Masking (Medium effort, high impact)
- [ ] Implement age-based observation masking in ChatHistoryCompactor
- [ ] Add Tier 1 masking to `buildL2ContextFromPreviousTurns()`
- [ ] Preserve tool call metadata while masking raw outputs

### Phase 3: Progressive Compaction (Medium effort, medium impact)
- [ ] Implement sliding window compaction with configurable interval
- [ ] Add overlap parameter for window boundaries
- [ ] Replace single-shot compaction trigger with progressive approach

### Phase 4: Content-Aware & Metrics (Higher effort, medium impact)
- [ ] Add content-type detection to compactionUtils
- [ ] Implement type-specific compaction strategies
- [ ] Build context usage UI indicator
- [ ] Add structured compaction metrics logging

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Structured summary still loses information | Keep verbatim paths/references in dedicated section |
| Progressive compaction adds latency per turn | Only compact if oldest tier needs upgrading; cache results |
| Observation masking too aggressive | Keep full output for most recent 2 turns minimum |
| Multiple compaction strategies increase complexity | Shared `compactionUtils.ts` with strategy pattern |
| LLM summarization cost (API calls per compaction) | Batch small items; skip items under threshold; use fast model |

## 7. Success Metrics

- **Context efficiency**: Tokens used vs. information retained (measured by follow-up question accuracy)
- **Conversation length**: Number of useful turns before quality degrades
- **Compaction latency**: Time to compact (target: < 3s for progressive, < 10s for full)
- **User satisfaction**: Reduced "the AI forgot what I said earlier" complaints
- **Compression ratio**: Target 70-85% for Tier 1, 90%+ for Tier 2

## 8. References

- [OpenAI Codex Compaction API](https://developers.openai.com/api/docs/guides/compaction/)
- [Compaction vs Summarization: Agent Context Management Compared (Morph)](https://www.morphllm.com/compaction-vs-summarization)
- [Context Compaction Research: Claude Code, Codex CLI, OpenCode, Amp (GitHub Gist)](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f)
- [Google ADK Context Compaction](https://google.github.io/adk-docs/context/compaction/)
- [Amp drops compaction for 'handoff'](https://ainativedev.io/news/amp-retires-compaction-for-a-cleaner-handoff-in-the-coding-agent-context-race)
