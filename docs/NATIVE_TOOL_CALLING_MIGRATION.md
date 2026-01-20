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
| Bedrock      | BedrockChatModel native tool calling (streaming + non-streaming) | ✅ Done |
| Copilot Plus | copilot-plus-flash native tool calling (via ChatOpenRouter)      | ✅ Done |

**Notes:**

- `AutonomousAgentChainRunner` now uses `bindTools()` - no XML format instructions
- `xmlParsing.ts` retained for `CopilotPlusChainRunner` (still uses XML)
- Model adapters retained but XML instructions are dead code for agent mode
- COPILOT_PLUS provider uses `ChatOpenRouter` for proper SSE tool_call parsing

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

### Phase 3: Migrate CopilotPlusChainRunner

| Task                            | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| [ ] Replace XML tool format     | Use `bindTools()` instead of XML instructions          |
| [ ] Update response parsing     | Parse `tool_calls` from AIMessage instead of XML regex |
| [ ] Remove XML system prompt    | Remove tool format instructions                        |
| [ ] Update tool result handling | Use `ToolMessage` instead of XML format                |

### Phase 4: Delete XML Utilities

| Task                            | Description                    |
| ------------------------------- | ------------------------------ |
| [ ] Delete `xmlParsing.ts`      | Remove XML parsing utilities   |
| [ ] Delete `xmlParsing.test.ts` | Remove tests                   |
| [ ] Remove `escapeXml` usage    | Clean up `contextProcessor.ts` |

### Phase 5: Clean Up Model Adapters

| Task                                      | Description                               |
| ----------------------------------------- | ----------------------------------------- |
| [ ] Remove XML templates                  | Delete `getToolCallFormat()`, XML strings |
| [ ] Remove model-specific XML workarounds | GPT, Claude, Gemini handlers              |
| [ ] Simplify adapter interface            | Keep only capability checks               |

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
4. **CopilotPlusChainRunner** - Migrate to native tool calling (Phase 3)
5. **Simplify Chat Persistence** - Only persist user messages + AI final responses (Phase 8)
6. **XML Cleanup** - Delete utilities and clean up adapters (Phase 9)
7. **Local Model Providers** - LM Studio and Ollama tool calling support (Phase 10)

### Estimated Additional Reduction

| Component                    | Current   | After    |
| ---------------------------- | --------- | -------- |
| xmlParsing.ts                | ~400      | 0        |
| modelAdapter.ts (XML)        | ~500      | ~50      |
| toolCallParser.ts            | ~200      | ~50      |
| CopilotPlusChainRunner (XML) | ~300      | ~100     |
| **Total**                    | **~1400** | **~200** |

**85% additional reduction after full XML removal.**
