# Claude Code Mode for Obsidian-Copilot

## Goal

Add a "Claude Code mode" to obsidian-copilot that provides Claude Agent SDK capabilities (file read/write, bash, multi-step agentic workflows) while reusing existing UI and chat infrastructure.

## Design Decisions (Confirmed)

| Decision        | Choice        | Rationale                                                                                      |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| SDK Integration | Proxy via CLI | Uses `@anthropic-ai/claude-agent-sdk` which spawns Claude CLI via `pathToClaudeCodeExecutable` |
| UI Reuse        | Full reuse    | New ChainRunner transforms SDK messages to existing ChatMessage format                         |
| Tool Scope      | Full access   | All tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch, Task                      |
| Security        | Configurable  | User-defined allowed paths in settings                                                         |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Existing Obsidian-Copilot                        │
├─────────────────────────────────────────────────────────────────────┤
│  Chat.tsx → ChatMessages → ChatSingleMessage → ToolCallBanner        │
│       ↑                                                              │
│  ChatUIState → ChatManager → MessageRepository                       │
│       ↑                                                              │
│  getAIResponse() → ChainManager.runChain()                          │
│       ↑                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ NEW: ClaudeCodeChainRunner extends BaseChainRunner          │    │
│  │      ↓                                                       │    │
│  │ ClaudeCodeService (persistent query wrapper)                │    │
│  │      ↓                                                       │    │
│  │ MessageChannel (queueing, merging)                          │    │
│  │      ↓                                                       │    │
│  │ transformSDKMessage() → StreamChunk → ChatMessage            │    │
│  │      ↓                                                       │    │
│  │ @anthropic-ai/claude-agent-sdk query()                      │    │
│  │      ↓                                                       │    │
│  │ Claude CLI (pathToClaudeCodeExecutable)                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: SDK Integration Layer

**Files to Create:**

1. **`src/core/claudeCode/ClaudeCodeService.ts`**

   - Wraps `@anthropic-ai/claude-agent-sdk` with persistent query pattern
   - Manages session lifecycle (init, resume, abort)
   - Handles CLI path detection (`findClaudeCliPath()`)
   - Configures hooks for security and diff tracking

2. **`src/core/claudeCode/MessageChannel.ts`**

   - Implements `AsyncIterable<SDKUserMessage>` interface
   - Queues messages while turn is active
   - Merges consecutive text messages (up to 12,000 chars)
   - Max queue depth: 8 messages

3. **`src/core/claudeCode/transformSDKMessage.ts`**

   - Generator function: `function* transformSDKMessage(message: SDKMessage)`
   - Transforms SDK message types to StreamChunk:
     - `system` (init) → `session_init`
     - `assistant` (text/thinking/tool_use) → `text`, `thinking`, `tool_use`
     - `user` (tool_result) → `tool_result`
     - `stream_event` (deltas) → incremental updates
     - `result` → `usage` info
     - `error` → `error`

4. **`src/core/claudeCode/types.ts`**
   - `StreamChunk` type definitions
   - `SDKMessage` type definitions
   - `UsageInfo` interface

**Dependencies:**

```json
{
  "@anthropic-ai/claude-agent-sdk": "^0.1.62"
}
```

### Phase 2: Chain Runner

**Files to Create:**

1. **`src/LLMProviders/chainRunner/ClaudeCodeChainRunner.ts`**

   ```typescript
   export class ClaudeCodeChainRunner extends BaseChainRunner {
     private service: ClaudeCodeService;

     async run(
       userMessage: ChatMessage,
       abortController: AbortController,
       updateCurrentAiMessage: (message: string) => void,
       addMessage: (message: ChatMessage) => void,
       options: ChainRunnerOptions
     ): Promise<string> {
       // 1. Send message via service
       // 2. Stream chunks via transformSDKMessage
       // 3. Convert chunks to ToolCallMarker format for existing UI
       // 4. Call updateCurrentAiMessage for streaming
       // 5. Call addMessage on completion
     }
   }
   ```

2. **Chunk to ChatMessage Transformation:**
   - `text` chunks → append to message content
   - `thinking` chunks → wrap in `<think>` tags (existing renderer handles)
   - `tool_use` chunks → convert to XML tool call marker format
   - `tool_result` chunks → append to corresponding tool call marker

**Files to Modify:**

1. **`src/chainFactory.ts`**

   ```typescript
   enum ChainType {
     // ... existing
     CLAUDE_CODE_CHAIN = "claude_code",
   }
   ```

2. **`src/LLMProviders/chainManager.ts`**
   - Add case for `CLAUDE_CODE_CHAIN` in chain runner factory

### Phase 3: Security & Hooks

**Files to Create:**

1. **`src/core/claudeCode/securityHooks.ts`**

   **Blocklist Hook (PreToolUse):**

   - Block dangerous commands: `rm -rf /`, `chmod 777`, etc.
   - Platform-aware (Unix + Windows commands)
   - Configurable in settings

   **Vault Restriction Hook (PreToolUse):**

   - File tools: Check path is within allowed paths
   - Bash: Parse command for path violations
   - Return `{ allowed: false, reason: "..." }` if blocked

   **Diff Tracking Hooks (Pre/Post ToolUse):**

   - Pre: Capture original file content (max 100KB)
   - Post: Capture new content, compute diff
   - Store in Map indexed by `tool_use_id`

### Phase 4: UI Enhancements

**Files to Modify:**

1. **`src/components/chat-components/ChatControls.tsx`**

   - Add "Claude Code" option to chain type selector
   - Only show when Claude Code is configured

2. **`src/components/chat-components/ToolCallBanner.tsx`** (Optional Enhancement)

   - Add diff rendering for Write/Edit tool results
   - Show word-level diffs with color coding

3. **`src/components/chat-components/ChatSingleMessage.tsx`** (Optional Enhancement)
   - Handle subagent tool calls (Task tool)
   - Nested rendering for async subagents

### Phase 5: Settings & Configuration

**New Settings Tab:**

Create dedicated "Claude Code" settings tab at `src/settings/v2/ClaudeCodeSettingsTab.tsx`:

| Setting             | Type               | Description                                      |
| ------------------- | ------------------ | ------------------------------------------------ |
| Enable Claude Code  | Toggle             | Master switch for Claude Code mode               |
| CLI Path            | Text + Auto-detect | Path to Claude CLI executable                    |
| Model               | Dropdown           | claude-sonnet-4-20250514, claude-opus-4-20250514 |
| Permission Mode     | Dropdown           | "YOLO" (auto-approve) or "Approval Required"     |
| Allowed Paths       | Multi-line text    | Additional paths beyond vault (one per line)     |
| Blocked Commands    | Multi-line text    | Dangerous commands to block                      |
| Enable Diff Display | Toggle             | Show file diffs for Write/Edit operations        |
| Max Thinking Tokens | Dropdown           | Budget for extended thinking                     |

**Files to Create:**

1. **`src/settings/v2/ClaudeCodeSettingsTab.tsx`**
   - New settings tab component
   - CLI path auto-detection with "Detect" button
   - Path validation with status indicator

**Files to Modify:**

1. **`src/settings/model.ts`**

   ```typescript
   interface CopilotSettings {
     // ... existing

     // Claude Code settings
     claudeCodeEnabled: boolean;
     claudeCodeCliPath: string; // Auto-detect or manual
     claudeCodeModel: "claude-sonnet-4-20250514" | "claude-opus-4-20250514";
     claudeCodeAllowedPaths: string[]; // Additional paths beyond vault
     claudeCodeBlockedCommands: string[]; // Dangerous commands to block
     claudeCodePermissionMode: "yolo" | "approval"; // Tool approval mode
     claudeCodeEnableDiffDisplay: boolean;
     claudeCodeMaxThinkingTokens: number;
   }
   ```

2. **`src/settings/v2/SettingsMain.tsx`** - Add Claude Code tab to navigation

---

## Key Files Reference

### New Files (9)

| Path                                                    | Purpose                                       |
| ------------------------------------------------------- | --------------------------------------------- |
| `src/core/claudeCode/ClaudeCodeService.ts`              | SDK wrapper with persistent query             |
| `src/core/claudeCode/MessageChannel.ts`                 | Message queueing and merging                  |
| `src/core/claudeCode/transformSDKMessage.ts`            | SDK → StreamChunk generator                   |
| `src/core/claudeCode/securityHooks.ts`                  | Security hooks (blocklist, vault restriction) |
| `src/core/claudeCode/diffTracker.ts`                    | File diff tracking for Write/Edit             |
| `src/core/claudeCode/types.ts`                          | Type definitions                              |
| `src/core/claudeCode/cliDetection.ts`                   | Claude CLI path detection                     |
| `src/LLMProviders/chainRunner/ClaudeCodeChainRunner.ts` | Chain runner implementation                   |
| `src/settings/v2/ClaudeCodeSettingsTab.tsx`             | New Claude Code settings tab                  |

### Modified Files (6)

| Path                                              | Changes                                         |
| ------------------------------------------------- | ----------------------------------------------- |
| `src/chainFactory.ts`                             | Add `CLAUDE_CODE_CHAIN` enum                    |
| `src/LLMProviders/chainManager.ts`                | Add chain runner factory case                   |
| `src/components/chat-components/ChatControls.tsx` | Add to selector                                 |
| `src/settings/model.ts`                           | Add Claude Code settings interface              |
| `src/settings/v2/SettingsMain.tsx`                | Add Claude Code tab to navigation               |
| `package.json`                                    | Add `@anthropic-ai/claude-agent-sdk` dependency |

---

## Tool Call Format Mapping

Existing copilot uses XML markers. Transform SDK tool calls to match:

**SDK Tool Use:**

```typescript
{ type: 'tool_use', id: 'tool-123', name: 'Read', input: { file_path: '/path' } }
```

**Copilot Tool Marker Format:**

```xml
<tool_call id="tool-123" name="Read">
{"file_path": "/path"}
</tool_call>
{result here}
</tool_call_end>
```

The existing `parseToolCallMarkers()` in `ChatSingleMessage.tsx` will handle rendering.

---

## Verification Plan

### Unit Tests

- [ ] `transformSDKMessage` - all message types
- [ ] `MessageChannel` - queueing, merging, overflow
- [ ] Security hooks - blocklist, vault restriction
- [ ] CLI detection - various install locations

### Integration Tests

- [ ] `ClaudeCodeChainRunner` with mock SDK
- [ ] End-to-end message flow
- [ ] Session resume

### Manual Testing

- [ ] Basic chat in Claude Code mode
- [ ] File read operation
- [ ] File write operation (verify diff display)
- [ ] Bash command execution
- [ ] Tool call display and collapsible results
- [ ] Session resume after restart
- [ ] Security: blocked command rejection
- [ ] Security: path restriction enforcement
- [ ] Abort/cancel mid-stream

---

## Implementation Order

1. **Phase 1: Foundation**

   - Add SDK dependency
   - Create `types.ts`, `cliDetection.ts`
   - Implement `transformSDKMessage.ts`
   - Implement `MessageChannel.ts`

2. **Phase 2: Core Integration**

   - Implement `ClaudeCodeService.ts`
   - Implement `ClaudeCodeChainRunner.ts`
   - Add chain type enum and factory
   - Basic end-to-end flow working

3. **Phase 3: Security & Polish**

   - Implement security hooks
   - Create Claude Code settings tab
   - Enhance tool call rendering
   - Add diff display (optional)

4. **Phase 4: Testing & Refinement**
   - Unit tests
   - Integration tests
   - Manual testing
   - Documentation

---

## Status: Ready for Implementation
