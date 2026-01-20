# Migration Plan: XML Tool Calling → LangChain Native Tool Calling

## Goal

1. Replace XML-based tool calling with LangChain native tool calling
2. **Aggressively simplify** the agent loop to follow the standard ReAct pattern
3. Stay model-switchable while removing XML complexity

---

## Migration Status

### ✅ COMPLETED

| Phase        | Description                                                      | Status  |
| ------------ | ---------------------------------------------------------------- | ------- |
| Phase 1      | Tool definitions, registry, metadata, nativeToolCalling.ts       | ✅ Done |
| Phase 2      | Simplified AutonomousAgentChainRunner with ReAct loop            | ✅ Done |
| Phase 3      | CopilotPlusChainRunner migrated to native tool calling           | ✅ Done |
| Phase 4      | XML tool parsing functions removed (kept escape/unescape only)   | ✅ Done |
| Phase 5      | Model adapters cleaned up - XML templates removed                | ✅ Done |
| Bedrock      | BedrockChatModel native tool calling (streaming + non-streaming) | ✅ Done |
| Copilot Plus | copilot-plus-flash native tool calling (via ChatOpenRouter)      | ✅ Done |

**Notes:**

- `AutonomousAgentChainRunner` now uses `bindTools()` - no XML format instructions
- `CopilotPlusChainRunner` now uses `bindTools()` for tool planning
- `xmlParsing.ts` simplified to only `escapeXml`, `unescapeXml`, `escapeXmlAttribute` for context envelope processing
- Model adapters cleaned up - XML `<use_tool>` templates removed, kept behavioral guidance only
- COPILOT_PLUS provider uses `ChatOpenRouter` for proper SSE tool_call parsing
- `ToolCall` interface moved to `toolExecution.ts`

### 🔲 REMAINING

See **Testing** and **What's Left** sections below.

---

## ReAct Pattern (Reference)

1. **Reasoning**: Model analyzes the task
2. **Acting**: Model returns `AIMessage` with `tool_calls`
3. **Observation**: Tool results fed back as `ToolMessage`
4. **Iteration**: Repeat until no more `tool_calls`

---

## Simplification Summary

### Removed

- `ModelAdapter` XML format instructions
- `xmlParsing.ts` (for agent mode)
- XML markers in `toolCallParser.ts`
- `ConversationMessage` type → use `BaseMessage[]`
- `iterationHistory` tracking → just messages array
- Complex streaming display → simple content accumulation

### Kept

- `StructuredTool` from registry
- `bindTools()` for native tool binding
- `ThinkBlockStreamer` for thinking content
- `executeSequentialToolCall()` with timeout
- Source collection for UI

### Code Reduction

| Before            | After      |
| ----------------- | ---------- |
| ~2500 lines       | ~200 lines |
| **92% reduction** |            |

---

## Gemini Compatibility

Gemini only supports subset of JSON Schema. Avoid:

- `.positive()` → use `.min(1)` instead
- `.gt(n)`, `.lt(n)` → use `.min(n)`, `.max(n)` instead

---

## Testing (🔲 REMAINING)

### Manual Tests

- [ ] "Search my notes about X" → localSearch
- [x] "What did I do this month" → getTimeRangeMs + localSearch
- [ ] Multi-tool conversation
- [ ] Streaming display
- [ ] Abort mid-execution

### Provider Validation

- [ ] OpenAI GPT-4
- [ ] Anthropic Claude
- [ ] Google Gemini
- [ ] OpenRouter models
- [x] Amazon Bedrock
- [x] Copilot Plus (copilot-plus-flash)
- [x] LM Studio (gpt-oss-20b)
- [ ] Ollama (tool-capable models)

### Edge Cases

- [ ] Model without tool support falls back
- [ ] Tool timeout handled
- [ ] Invalid args handled
- [ ] Max iterations respected

---

## 🔲 What's Left to Remove XML Completely

### ✅ Phase 3: Migrate CopilotPlusChainRunner

**COMPLETED** - CopilotPlusChainRunner now uses native tool calling.

| Task                         | Description                                                           | Status  |
| ---------------------------- | --------------------------------------------------------------------- | ------- |
| [x] Replace XML tool format  | Use `bindTools()` instead of XML instructions                         | ✅ Done |
| [x] Update response parsing  | Parse `tool_calls` from AIMessage instead of XML regex                | ✅ Done |
| [x] Remove XML system prompt | Remove tool format instructions                                       | ✅ Done |
| [x] Tool result handling     | CopilotPlus doesn't use ReAct loop - results passed to final LLM call | ✅ N/A  |

**Implementation notes:**

- `planToolCalls()` now uses `chatModel.bindTools(availableTools)` instead of XML descriptions
- Tool calls extracted from `response.tool_calls` instead of `parseXMLToolCalls()`
- Salient terms extracted via simple text pattern `[SALIENT_TERMS: ...]` with fallback
- `unescapeXml` still used for context envelope image extraction (separate from tool calling)

### ✅ Phase 4: Delete XML Tool Parsing Utilities

**COMPLETED** - XML tool parsing functions removed, kept escape/unescape for context envelope.

| Task                                           | Description                                           | Status  |
| ---------------------------------------------- | ----------------------------------------------------- | ------- |
| [x] Remove XML tool parsing from xmlParsing.ts | Removed `parseXMLToolCalls`, `stripToolCallXML`, etc. | ✅ Done |
| [x] Move ToolCall interface                    | Moved to `toolExecution.ts` where it's actually used  | ✅ Done |
| [x] Update xmlParsing.test.ts                  | Simplified to only test escape/unescape functions     | ✅ Done |
| [x] Keep escape/unescape                       | Retained for context envelope image URL processing    | ✅ Done |

**Implementation notes:**

- `xmlParsing.ts` now only exports: `escapeXml`, `unescapeXml`, `escapeXmlAttribute`
- `ToolCall` interface moved to `toolExecution.ts` with execution utilities
- Legacy integration test `AgentPrompt.test.ts` skipped (tests old XML flow)

### ✅ Phase 5: Clean Up Model Adapters

**COMPLETED** - XML `<use_tool>` templates removed from all adapters.

| Task                                      | Description                                            | Status  |
| ----------------------------------------- | ------------------------------------------------------ | ------- |
| [x] Remove XML templates                  | Removed `<use_tool>` format instructions               | ✅ Done |
| [x] Remove model-specific XML workarounds | Simplified GPT, Claude, Gemini guidance                | ✅ Done |
| [x] Remove premature response handling    | Removed detectPrematureResponse, sanitizeResponse, etc | ✅ Done |
| [x] Update adapter tests                  | Fixed assertions for new simplified prompts            | ✅ Done |

**Implementation notes:**

- `BaseModelAdapter.buildSystemPromptSections` now says "Tools are provided via native function calling"
- `GPTModelAdapter` no longer includes verbose XML examples, just behavioral guidance
- `ClaudeModelAdapter` simplified - removed XML patterns, kept thinking model guidance
- `GeminiModelAdapter` removed XML examples, kept sequential tool call guidance
- Removed `detectPrematureResponse`, `sanitizeResponse`, `shouldTruncateStreaming` - not needed with native tool calling (tool calls are in structured `response.tool_calls`, not embedded XML)

### Phase 6: Replace Tool Call Banner UI

| Task                                | Description                                               |
| ----------------------------------- | --------------------------------------------------------- |
| [ ] Implement Agent Reasoning Block | See `docs/AGENT_REASONING_BLOCK.md`                       |
| [ ] Remove marker creation          | Delete `createToolCallMarker()`, `updateToolCallMarker()` |
| [ ] Keep marker parsing             | Retain for old saved messages                             |
| [ ] Deprecate ToolCallBanner        | Keep for backward compat                                  |

### Phase 7: Human-in-the-Loop Tool Approval

| Task                               | Description                                               |
| ---------------------------------- | --------------------------------------------------------- |
| [ ] Define risky tool categories   | Identify tools requiring approval (edit, delete, create)  |
| [ ] Add tool metadata for approval | Extend `ToolMetadata` with `requiresApproval` flag        |
| [ ] Create ApprovalModal component | Modal showing tool name, args, and approve/reject buttons |
| [ ] Integrate into agent loop      | Pause execution, show modal, wait for user response       |
| [ ] Add approval timeout handling  | Auto-reject after configurable timeout                    |
| [ ] Settings for approval behavior | Per-tool approval toggles, "trust this session" option    |

### Phase 8: Simplify Chat Persistence

| Task                                             | Description                                               |
| ------------------------------------------------ | --------------------------------------------------------- |
| [ ] Remove tool call markers from saved messages | Only persist user messages and AI final responses         |
| [ ] Update ChatPersistenceManager                | Skip intermediate tool results during save                |
| [ ] Update chat load logic                       | No need to parse tool markers from saved chats            |
| [ ] Keep reasoning metadata                      | Persist elapsed time and step summaries in final response |

**Note:** Intermediate tool call results (ToolMessages, AIMessages with tool_calls) will NOT be persisted. Only:

- User messages (HumanMessage)
- AI final responses (with optional reasoning block metadata)

This simplifies persistence and reduces chat file size significantly.

### Phase 9: Final Cleanup

| Task                                       | Description                      |
| ------------------------------------------ | -------------------------------- |
| [ ] Remove ThinkBlockStreamer XML handling | Remove tool call marker emission |
| [ ] Audit for remaining XML refs           | Search for `<tool_call` patterns |
| [ ] Update documentation                   | Remove XML references            |

### Phase 10: Local Model Provider Tool Calling

| Task                                  | Description                                                    | Status  |
| ------------------------------------- | -------------------------------------------------------------- | ------- |
| [x] LM Studio tool calling support    | gpt-oss-20b works via OpenAI-compatible API                    | ✅ Done |
| [ ] Ollama tool calling support       | Test tool-capable Ollama models (llama3.1, mistral-nemo, etc.) |         |
| [x] Verify OpenAI-compatible format   | LM Studio emits tool_calls in standard format                  | ✅ Done |
| [ ] Handle model capability detection | Graceful fallback when model doesn't support tools             |         |
| [ ] Document supported local models   | List tested models with tool calling capability                |         |

**Notes:**

- LM Studio exposes OpenAI-compatible API - works with existing ChatOpenAI
- Ollama has native tool calling support since v0.3+ for supported models
- **Tested models:** gpt-oss-20b (LM Studio)
- May need model-specific schema adjustments (similar to Gemini restrictions)

---

## 📋 Next Steps (Priority Order)

1. **Testing** - Complete manual functional tests and provider validation
2. **Agent Reasoning Block** - Implement new UI (see `docs/AGENT_REASONING_BLOCK.md`)
3. **Human-in-the-Loop Approval** - Add approval UI for risky tools (Phase 7)
4. ~~**CopilotPlusChainRunner**~~ - ✅ Done (Phase 3)
5. ~~**XML Cleanup**~~ - ✅ Done (Phases 4, 5 - kept escape/unescape for context envelope)
6. **Simplify Chat Persistence** - Only persist user messages + AI final responses (Phase 8)
7. **Final Cleanup** - Audit remaining XML refs, update documentation (Phase 9)
8. **Local Model Providers** - Ollama tool calling support (Phase 10)

### Code Reduction Summary (Phases 4 & 5 Complete)

| Component              | Before | After | Reduction |
| ---------------------- | ------ | ----- | --------- |
| xmlParsing.ts          | ~400   | ~50   | 87%       |
| modelAdapter.ts        | ~900   | ~650  | 28%       |
| xmlParsing.test.ts     | ~400   | ~130  | 67%       |
| CopilotPlusChainRunner | ~300   | ~200  | 33%       |

**Notes:**

- XML tool parsing completely removed from `xmlParsing.ts`
- Kept only `escapeXml`, `unescapeXml`, `escapeXmlAttribute` for context envelope
- Model adapters simplified but retained behavioral guidance for GPT/Claude/Gemini quirks
- All 1417 tests passing
