# Claude Code Integration - Epic & Story Breakdown

## Overview

This document provides the detailed story breakdown for implementing Claude Code CLI integration into Obsidian Copilot. Each story includes acceptance criteria, technical tasks, and dependencies.

## Epic 1: Foundation & Project Setup ⚡ Priority: CRITICAL

**Goal:** Establish the development foundation with project structure, core provider skeleton, and basic integration validation.

### Story 1.1: Project Setup and Development Environment

**As a** developer,  
**I want** the project structure and development environment configured,  
**So that** I can begin implementing Claude Code integration features.

**Acceptance Criteria:**

- [ ] Feature branch created from main/master
- [ ] New directory structure created: `src/LLMProviders/claudeCode/`
- [ ] TypeScript configuration verified for new modules
- [ ] Build process successfully includes new files
- [ ] Development environment can spawn child processes
- [ ] Initial tests can run without errors

**Technical Tasks:**

1. Create feature branch: `feature/claude-code-integration`
2. Create directory structure:
   ```
   src/LLMProviders/claudeCode/
   ├── ChatClaudeCode.ts
   ├── ClaudeCliInterface.ts
   ├── ClaudeStreamParser.ts
   ├── ClaudeSessionManager.ts
   ├── ClaudeDetector.ts
   ├── types.ts
   └── platform/
       ├── WindowsHandler.ts
       ├── MacOSHandler.ts
       └── LinuxHandler.ts
   ```
3. Add placeholder implementations with proper exports
4. Verify esbuild bundles new files correctly
5. Create basic test files with smoke tests
6. Document setup in README

**Dependencies:** None
**Estimated Points:** 3

---

### Story 1.2: Provider Registration Infrastructure

**As a** developer,  
**I want** Claude Code registered in the provider system,  
**So that** it appears as a selectable option in the model dropdown.

**Acceptance Criteria:**

- [ ] CLAUDE_CODE enum added to ChatModelProviders in constants.ts
- [ ] ChatClaudeCode skeleton class created extending SimpleChatModel
- [ ] Provider added to CHAT_PROVIDER_CONSTRUCTORS mapping
- [ ] Provider API key map updated with "local" placeholder
- [ ] Provider appears in UI dropdown (non-functional is OK)
- [ ] No regression in existing provider functionality

**Technical Tasks:**

1. Update `src/constants.ts`:
   ```typescript
   export enum ChatModelProviders {
     // ... existing providers
     CLAUDE_CODE = "claude-code",
   }
   ```
2. Create `ChatClaudeCode.ts` skeleton:
   ```typescript
   export class ChatClaudeCode extends SimpleChatModel {
     _llmType() {
       return "claude-code";
     }
     _call() {
       /* TODO */
     }
     _streamResponseChunks() {
       /* TODO */
     }
   }
   ```
3. Update `chatModelManager.ts` to register provider
4. Add to provider API key map with "local" value
5. Test dropdown shows new provider
6. Run regression tests

**Dependencies:** Story 1.1
**Estimated Points:** 5

---

### Story 1.3: Basic CLI Validation

**As a** developer,  
**I want** to validate Claude CLI execution from Node.js,  
**So that** I confirm the technical approach is viable.

**Acceptance Criteria:**

- [ ] Node script successfully spawns Claude CLI
- [ ] `claude --version` command returns version info
- [ ] Process spawning works in Obsidian plugin context
- [ ] Error handling for missing CLI works
- [ ] Works on macOS and Windows (minimum)
- [ ] Proof-of-concept documented

**Technical Tasks:**

1. Create validation script:
   ```typescript
   // Test Claude CLI availability
   const testCli = async () => {
     const { spawn } = require("child_process");
     const claude = spawn("claude", ["--version"]);
     // Handle stdout, stderr, exit
   };
   ```
2. Test in Obsidian developer console
3. Handle PATH vs explicit path scenarios
4. Test error cases (CLI not found)
5. Document platform-specific findings
6. Create proof-of-concept report

**Dependencies:** Story 1.1
**Estimated Points:** 3

---

## Epic 2: Core Chat Integration 💬

**Goal:** Implement the fundamental chat functionality enabling users to send messages to Claude Code and receive responses.

### Story 2.1: ChatClaudeCode Class Implementation

**As a** developer,  
**I want** to implement the ChatClaudeCode class,  
**So that** it properly extends SimpleChatModel with Claude-specific logic.

**Acceptance Criteria:**

- [ ] ChatClaudeCode properly extends SimpleChatModel
- [ ] Constructor accepts ClaudeCodeConfig interface
- [ ] \_llmType() returns "claude-code"
- [ ] Configuration properties handled correctly
- [ ] Stub methods don't break chat flow
- [ ] Class instantiates without errors

**Technical Tasks:**

1. Define ClaudeCodeConfig interface:
   ```typescript
   interface ClaudeCodeConfig {
     cliPath?: string;
     model?: string;
     sessionMode?: "new" | "continue";
     timeout?: number;
   }
   ```
2. Implement constructor with config handling
3. Add property validation
4. Implement \_llmType() method
5. Create stub \_call() method
6. Create unit tests

**Dependencies:** Epic 1 complete
**Estimated Points:** 5

---

### Story 2.2: CLI Interface Layer

**As a** developer,  
**I want** a dedicated CLI interface layer,  
**So that** I can reliably execute Claude commands and handle responses.

**Acceptance Criteria:**

- [ ] ClaudeCliInterface class created
- [ ] execute() method runs basic CLI calls
- [ ] buildArgs() constructs command arguments
- [ ] stdout, stderr, exit codes handled properly
- [ ] 30-second timeout mechanism works
- [ ] Platform-specific options handled

**Technical Tasks:**

1. Implement ClaudeCliInterface class:
   ```typescript
   class ClaudeCliInterface {
     async execute(command: string, args: string[]): Promise<string>;
     spawn(command: string, args: string[]): ChildProcess;
     buildArgs(message: string, options: any): string[];
   }
   ```
2. Add timeout handling with AbortController
3. Implement platform detection
4. Add logging for debugging
5. Handle process cleanup
6. Create integration tests

**Dependencies:** Story 2.1
**Estimated Points:** 8

---

### Story 2.3: Basic Message Processing

**As a** user,  
**I want** to send a message to Claude Code and receive a response,  
**So that** I can use local AI assistance in Obsidian.

**Acceptance Criteria:**

- [ ] \_call method implemented in ChatClaudeCode
- [ ] Messages formatted for Claude CLI input
- [ ] CLI executed with correct flags
- [ ] JSON response parsed correctly
- [ ] Response returned to chat UI
- [ ] Basic errors shown to user

**Technical Tasks:**

1. Implement \_call method:
   ```typescript
   async _call(messages, options, runManager) {
     const cliInterface = new ClaudeCliInterface();
     const args = ['--print', '--output-format', 'json'];
     const response = await cliInterface.execute('claude', args);
     return this.parseResponse(response);
   }
   ```
2. Format messages for CLI input
3. Parse JSON output
4. Handle error responses
5. Test with various message types
6. Add user-friendly error messages

**Dependencies:** Story 2.2
**Estimated Points:** 8

---

## Epic 3: Streaming Response System 🌊

**Goal:** Implement real-time streaming responses that display token-by-token in the chat interface.

### Story 3.1: Stream Parser Implementation

**As a** developer,  
**I want** a robust stream parser for Claude's output,  
**So that** I can process streaming JSON responses reliably.

**Acceptance Criteria:**

- [ ] ClaudeStreamParser class created
- [ ] Line-by-line JSON parsing works
- [ ] Malformed JSON handled gracefully
- [ ] Chunks converted to ChatGenerationChunk
- [ ] Stream errors detected
- [ ] Various response formats tested

**Technical Tasks:**

1. Create ClaudeStreamParser class
2. Implement buffered line reading
3. Parse JSON lines with error recovery
4. Convert to LangChain chunk format
5. Add error detection patterns
6. Create comprehensive tests

**Dependencies:** Epic 2 complete
**Estimated Points:** 5

---

### Story 3.2: Async Generator Implementation

**As a** developer,  
**I want** to implement the streaming response method,  
**So that** responses stream smoothly to the UI.

**Acceptance Criteria:**

- [ ] \_streamResponseChunks async generator implemented
- [ ] CLI spawned with stream-json output format
- [ ] ChatGenerationChunk objects yielded properly
- [ ] runManager.handleLLMNewToken called for each chunk
- [ ] Stream interruption handled gracefully
- [ ] Proper cleanup on stream end

**Technical Tasks:**

1. Implement async generator:
   ```typescript
   async *_streamResponseChunks(messages, options, runManager) {
     const cli = this.spawnClaude(['--output-format', 'stream-json']);
     for await (const chunk of this.parseStream(cli.stdout)) {
       yield new ChatGenerationChunk({ content: chunk });
       await runManager?.handleLLMNewToken(chunk);
     }
   }
   ```
2. Handle backpressure
3. Implement stream cancellation
4. Add cleanup logic
5. Test with long responses

**Dependencies:** Story 3.1
**Estimated Points:** 8

---

### Story 3.3: UI Streaming Integration

**As a** user,  
**I want** to see Claude's responses appear token-by-token,  
**So that** I get immediate feedback while the AI is thinking.

**Acceptance Criteria:**

- [ ] Streaming generator connects to UI updates
- [ ] Tokens display as they arrive
- [ ] Streaming indicator shows during generation
- [ ] User can interrupt streaming response
- [ ] UI remains responsive during streaming
- [ ] Works with 1000+ token responses

**Technical Tasks:**

1. Connect stream to existing UI handler
2. Ensure proper React state updates
3. Add streaming status indicator
4. Implement interrupt mechanism
5. Test UI performance
6. Handle edge cases

**Dependencies:** Story 3.2
**Estimated Points:** 5

---

## Implementation Sequence

### Phase 1: Foundation (Week 1)

1. Epic 1 - All stories (Sprint 1)
   - Critical for all subsequent work
   - Validates technical approach
   - No external dependencies

### Phase 2: Core Functionality (Week 2)

2. Epic 2 - All stories (Sprint 2)
   - Enables basic chat functionality
   - Proves integration works
   - Allows early testing

### Phase 3: Enhancement (Week 3)

3. Epic 3 - Streaming (Sprint 3)
   - Improves user experience
   - Adds real-time feedback
   - Non-blocking for other epics

### Phase 4: Production Ready (Week 4)

4. Epic 4 - Session Management
5. Epic 5 - Settings UI
6. Epic 6 - Auto-detection

### Phase 5: Polish (Week 5)

7. Epic 7 - Error Handling
8. Epic 8 - Performance
9. Epic 9 - Testing
10. Epic 10 - Documentation

## Risk Mitigation Matrix

| Risk                    | Mitigation                        | Owner  |
| ----------------------- | --------------------------------- | ------ |
| CLI not found           | Provide manual path configuration | User   |
| Process spawn fails     | Fallback to cloud provider        | System |
| Streaming breaks        | Fallback to non-streaming mode    | System |
| Session expires         | Create new session automatically  | System |
| Performance degradation | Add caching in Phase 5            | Dev    |

## Definition of Done

Each story is complete when:

- [ ] Code implemented and reviewed
- [ ] Unit tests pass (80% coverage)
- [ ] Integration tests pass
- [ ] No regression in existing features
- [ ] Documentation updated
- [ ] Tested on macOS and Windows
- [ ] Error handling implemented
- [ ] Logging added for debugging
