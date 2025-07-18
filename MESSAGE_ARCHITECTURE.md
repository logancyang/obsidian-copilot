# Message Architecture & Context Design

This document describes the new message management and context processing architecture that replaced the legacy SharedState system. The new design follows clean architecture principles with a single source of truth, computed views, and complete project isolation.

## Architecture Principles

### Single Source of Truth

- Each message is stored exactly once in `MessageRepository`
- All UI and LLM views are computed from this single storage
- No complex dual-array synchronization or ID matching

### Clean Architecture Flow

```
User Input → ChatUIState → ChatManager → getCurrentMessageRepo() → MessageRepository + ContextManager
                                   ↓                                        ↓
                         ChatPersistenceManager                    Project-specific storage
                ↓
UI Components ← ChatUIState ← Computed Views ← MessageRepository
                ↓
LLM Processing ← Chain Memory ← getLLMMessages() ← MessageRepository
```

### Context Always Fresh

- Context is reprocessed when messages are edited
- No stale context issues from cached processing
- Ensures accurate context for LLM interactions

### Project Isolation

- Each project maintains its own isolated chat history
- Automatic detection and switching when project changes
- Zero configuration required - works automatically
- Non-project chats use a default repository

## Core Components

### 1. MessageRepository (`src/core/MessageRepository.ts`)

**Purpose**: Single source of truth for all messages

**Key Concepts**:

- Stores `StoredMessage` objects with both `displayText` and `processedText`
- `displayText`: What the user typed or AI responded (for UI display)
- `processedText`: For user messages, includes context. For AI messages, same as display

**Core Methods**:

```typescript
// Add new message
addMessage(displayText: string, processedText: string, sender: string, context?: MessageContext): string

// Get computed views
getDisplayMessages(): ChatMessage[]  // For UI rendering
getLLMMessages(): ChatMessage[]      // For AI processing

// Edit operations
editMessage(id: string, newDisplayText: string): boolean
updateProcessedText(id: string, processedText: string): boolean

// Bulk operations
truncateAfterMessageId(messageId: string): void
loadMessages(messages: ChatMessage[]): void
```

### 2. ChatManager (`src/core/ChatManager.ts`)

**Purpose**: Central business logic coordinator

**Responsibilities**:

- Orchestrates MessageRepository, ContextManager, and LLM operations
- Handles all message CRUD operations with proper error handling
- Synchronizes with chain memory for conversation history
- Manages context processing lifecycle
- **Project Isolation**: Maintains separate MessageRepository per project
- **Persistence**: Integrates with ChatPersistenceManager for saving/loading

**Key Operations**:

```typescript
// Send new message with context processing
async sendMessage(displayText: string, context: MessageContext, chainType: ChainType, includeActiveNote?: boolean): Promise<string>

// Edit message and reprocess context
async editMessage(messageId: string, newText: string, chainType: ChainType, includeActiveNote?: boolean): Promise<boolean>

// Regenerate AI response
async regenerateMessage(messageId: string, onUpdateMessage: Function, onAddMessage: Function): Promise<boolean>

// Memory synchronization
private async updateChainMemory(): Promise<void>

// Project management
private getCurrentMessageRepo(): MessageRepository  // Auto-detects current project
async handleProjectSwitch(): Promise<void>          // Forces project detection

// Persistence
async saveChat(modelKey: string): Promise<{ success: boolean; path?: string; error?: string }>
```

**Project Isolation Implementation**:

```typescript
// Internal structure
private projectMessageRepos: Map<string, MessageRepository>

// Automatic project detection
getCurrentMessageRepo() {
  const currentProjectId = ProjectManager.getCurrentProjectId() || defaultProjectKey;
  if (!this.projectMessageRepos.has(currentProjectId)) {
    // Create new repository for this project
    const repo = new MessageRepository();
    this.projectMessageRepos.set(currentProjectId, repo);
  }
  return this.projectMessageRepos.get(currentProjectId)!;
}
```

### 3. ChatUIState (`src/state/ChatUIState.ts`)

**Purpose**: Clean UI-only state manager

**Design Philosophy**:

- Delegates ALL business logic to ChatManager
- Provides React integration with subscription mechanism
- Replaces legacy SharedState with minimal, focused approach

**React Integration**:

```typescript
// Subscribe to state changes
subscribe(listener: () => void): () => void

// Delegate operations to ChatManager
async sendMessage(displayText: string, context: MessageContext, chainType: ChainType, includeActiveNote?: boolean): Promise<string>
getMessages(): ChatMessage[]  // Computed view for UI

// Project and persistence operations
async handleProjectSwitch(): Promise<void>  // Handle UI updates for project switch
async saveChat(modelKey: string): Promise<{ success: boolean; path?: string; error?: string }>

// Legacy compatibility (for backward compatibility)
get chatHistory(): ChatMessage[]
addMessage(message: ChatMessage): void
clearChatHistory(): void

// Notify React components of changes
private notifyListeners(): void
```

### 4. ContextManager (`src/core/ContextManager.ts`)

**Purpose**: Handles context processing and reprocessing

**Key Features**:

- Processes message context (notes, URLs, selected text)
- Reprocesses context when messages are edited
- Ensures fresh context for LLM processing

### 5. ChatPersistenceManager (`src/core/ChatPersistenceManager.ts`)

**Purpose**: Handles saving and loading chat history to/from markdown files

**Key Features**:

- Project-aware file naming (prefixes with project ID)
- Filters chat history files based on current project
- Parses and formats chat content for storage
- Integrated with ChatManager for seamless persistence

**Core Methods**:

```typescript
// Save chat to markdown file
async saveChat(messages: ChatMessage[], modelKey: string, projectId?: string): Promise<{ success: boolean; path?: string; error?: string }>

// Get available chat history files
async getChatHistoryFiles(): Promise<TFile[]>

// File naming convention
// Project chats: `[projectId]-[timestamp]-[modelKey]-chat.md`
// Non-project chats: `[timestamp]-[modelKey]-chat.md`
```

## Architecture Diagrams

### Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   User Interface Layer                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─────────────────┐                          ┌──────────────────┐                 │
│  │   Chat.tsx      │ ◄────── uses ──────────► │  CopilotView.tsx │                 │
│  │                 │                           │                  │                 │
│  └────────┬────────┘                          └──────────────────┘                 │
│           │                                                                         │
│           │ subscribes to & calls                                                   │
│           ▼                                                                         │
└───────────┬─────────────────────────────────────────────────────────────────────────┘
            │
┌───────────┴─────────────────────────────────────────────────────────────────────────┐
│                                    State Layer                                       │
├─────────────────────────────────────────────────────────────────────────────────────┤
│           │                                                                         │
│  ┌────────▼────────┐                                                               │
│  │  ChatUIState    │  - React state management                                     │
│  │                 │  - Subscription mechanism for UI updates                       │
│  │                 │  - Delegates all business logic to ChatManager                │
│  └────────┬────────┘                                                               │
│           │                                                                         │
└───────────┴─────────────────────────────────────────────────────────────────────────┘
            │ delegates to
┌───────────▼─────────────────────────────────────────────────────────────────────────┐
│                               Business Logic Layer                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─────────────────┐         orchestrates        ┌─────────────────────────────┐   │
│  │   ChatManager   │ ◄──────────────────────────► │  ContextManager (singleton) │   │
│  │                 │                              │                             │   │
│  │ - Message CRUD  │                              │ - Process message context  │   │
│  │ - Project       │                              │ - Handle note attachments  │   │
│  │   isolation     │                              │ - Reprocess on edit        │   │
│  │ - Memory sync   │                              └─────────────────────────────┘   │
│  └────────┬────────┘                                                               │
│           │                                                                         │
│           │ manages                               ┌─────────────────────────────┐   │
│           │                                       │  ChatPersistenceManager     │   │
│           ├──────────────────────────────────────►│                             │   │
│           │                                       │ - Save/load chat history    │   │
│           │                                       │ - Project-aware file naming │   │
│           │                                       └─────────────────────────────┘   │
│           │                                                                         │
│           │ coordinates                           ┌─────────────────────────────┐   │
│           ├──────────────────────────────────────►│     ChainManager           │   │
│           │                                       │                             │   │
│           │                                       │ - Memory management         │   │
│           │                                       │ - LLM chain operations     │   │
│           │                                       └──────────┬──────────────────┘   │
│           │                                                  │                      │
│           │                                                  ▼                      │
│           │                                       ┌─────────────────────────────┐   │
│           │                                       │    MemoryManager            │   │
│           │                                       │                             │   │
│           │                                       │ - Chain memory storage      │   │
│           │                                       │ - Conversation history      │   │
│           │                                       └─────────────────────────────┘   │
└───────────┴─────────────────────────────────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────────────────────────────┐
│                                  Data Storage Layer                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                          MessageRepository                                   │   │
│  │                                                                             │   │
│  │  ┌─────────────────┐    Computed Views    ┌────────────────────────────┐  │   │
│  │  │ StoredMessage[] │ ──────────────────────► │ getDisplayMessages()     │  │   │
│  │  │                 │                       │ (for UI rendering)       │  │   │
│  │  │ - id            │                       └────────────────────────────┘  │   │
│  │  │ - displayText   │                                                        │   │
│  │  │ - processedText │ ──────────────────────► ┌────────────────────────────┐  │   │
│  │  │ - sender        │                       │ getLLMMessages()         │  │   │
│  │  │ - timestamp     │                       │ (for AI processing)      │  │   │
│  │  │ - context       │                       └────────────────────────────┘  │   │
│  │  └─────────────────┘                                                        │   │
│  │                                                                             │   │
│  │  Single source of truth - no dual storage!                                 │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Project Isolation Architecture

### Multi-Repository Design

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              ChatManager                                             │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  projectMessageRepos: Map<string, MessageRepository>                                │
│                                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐          │
│  │ "defaultProject" │     │   "project-1"    │     │   "project-2"    │          │
│  │                  │     │                  │     │                  │          │
│  │ MessageRepo      │     │ MessageRepo      │     │ MessageRepo      │          │
│  │ - Non-project    │     │ - Project 1      │     │ - Project 2      │          │
│  │   messages       │     │   messages only  │     │   messages only  │          │
│  └──────────────────┘     └──────────────────┘     └──────────────────┘          │
│           ▲                         ▲                         ▲                     │
│           │                         │                         │                     │
│           └─────────────────────────┴─────────────────────────┘                     │
│                                     │                                               │
│                        getCurrentMessageRepo()                                      │
│                        (auto-detects active project)                                │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Project Switch Flow

```
Project Switch Detected (via Obsidian workspace)
    ↓
ProjectManager.getCurrentProjectId() returns new ID
    ↓
ChatManager.getCurrentMessageRepo()
    ↓
Check if repository exists for project
    ↓ (if not)
Create new MessageRepository
    ↓
Store in projectMessageRepos Map
    ↓
Return project-specific repository
```

## Message Lifecycle

### 1. Sending a New Message

```
User Input
    ↓ (via Chat component)
ChatUIState.sendMessage()
    ↓
ChatManager.sendMessage()
    ↓
MessageRepository.addMessage() // Store with basic content
    ↓
ContextManager.processMessageContext() // Add context
    ↓
MessageRepository.updateProcessedText() // Update with context
    ↓
ChatManager.updateChainMemory() // Sync to LLM
    ↓
ChatUIState.notifyListeners() // Update UI
```

### 2. Editing a Message

```
User Edit
    ↓
ChatUIState.editMessage()
    ↓
ChatManager.editMessage()
    ↓
MessageRepository.editMessage() // Update display text
    ↓
ContextManager.reprocessMessageContext() // Fresh context
    ↓
ChatManager.updateChainMemory() // Sync to LLM
    ↓
ChatUIState.notifyListeners() // Update UI
```

### 3. Message Display

```
React Component Render
    ↓
ChatUIState.getMessages()
    ↓
ChatManager.getDisplayMessages()
    ↓
ChatManager.getCurrentMessageRepo() // Project-aware
    ↓
MessageRepository.getDisplayMessages() // Computed view
    ↓
Filter visible messages → Map to ChatMessage format
```

### 4. Saving Chat History

```
User Save Action
    ↓
Chat.tsx → ChatUIState.saveChat(modelKey)
    ↓
ChatManager.saveChat(modelKey)
    ↓
Get current project ID and messages
    ↓
ChatPersistenceManager.saveChat(messages, modelKey, projectId)
    ↓
Create markdown file with project prefix
    ↓
Return success with file path
```

### 5. Project Switch

```
Project Change in Obsidian
    ↓
ChatUIState.handleProjectSwitch()
    ↓
ChatManager.handleProjectSwitch()
    ↓
Force getCurrentMessageRepo() to re-detect project
    ↓
Switch to different MessageRepository
    ↓
Update chain memory with new project's messages
    ↓
Notify UI listeners for refresh
```

## Data Structures

### StoredMessage (Internal)

```typescript
interface StoredMessage {
  id: string;
  displayText: string; // What user typed/AI responded
  processedText: string; // With context for user, same as display for AI
  sender: string;
  timestamp: FormattedDateTime;
  context?: MessageContext;
  isVisible: boolean;
  isErrorMessage?: boolean;
  sources?: { title: string; score: number }[];
  content?: any[];
}
```

### ChatMessage (External Interface)

```typescript
interface ChatMessage {
  id?: string;
  message: string; // Display text
  originalMessage?: string; // Processed text
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  context?: MessageContext;
  isErrorMessage?: boolean;
  sources?: { title: string; score: number }[];
  content?: any[];
}
```

### MessageContext

```typescript
interface MessageContext {
  notes: TFile[];
  urls: string[];
  selectedTextContexts: SelectedTextContext[];
}
```

## Chat History Loading

### Pending Message Mechanism

The new architecture uses a "pending message" pattern for loading chat history:

```
main.ts.loadChatHistory()
    ↓
Parse messages from file
    ↓
CopilotView.setPendingMessages()
    ↓
Chat component receives pendingMessages prop
    ↓
useEffect detects pendingMessages
    ↓
ChatUIState.loadMessages()
    ↓
onPendingMessagesProcessed() callback clears pending
```

### Project-Aware Loading

When loading chat history:

1. ChatPersistenceManager filters files based on current project
2. Only shows chat files prefixed with current project ID
3. Non-project chats visible when no project is active

## Testing Strategy

### Unit Tests

- **MessageRepository**: 23 comprehensive tests including bug prevention
- **ChatManager**: 25+ tests covering all critical functionality
- **Component Tests**: MessageContext duplicate key prevention

### Bug Prevention Tests

1. **Context Badge Bug**: Ensures context displays correctly
2. **Memory Synchronization**: Prevents chat memory count mismatches
3. **Edit Message Bug**: Verifies proper context reprocessing
4. **Duplicate Notes**: Prevents React key conflicts in context display

## Migration from SharedState

### Before (Legacy)

```typescript
// Multiple sources of truth
const sharedState = {
  currentChatMessages: ChatMessage[],
  chatHistory: ChatMessage[],
  // Complex sync logic between arrays
}
```

### After (Clean Architecture)

```typescript
// Single source of truth
const messageRepository = new MessageRepository();
const chatManager = new ChatManager(messageRepository, ...);
const chatUIState = new ChatUIState(chatManager);

// Computed views
const displayMessages = chatUIState.getMessages(); // For UI
const llmMessages = chatManager.getLLMMessages();   // For AI
```

## Performance Considerations

### Memory Efficiency

- Single storage eliminates duplicate message objects
- Computed views are generated on-demand
- Context processing only when needed

### React Optimization

- Subscription-based updates minimize re-renders
- Unique keys prevent React reconciliation issues
- State changes are batched through ChatUIState

## Key Architectural Features

### Project Isolation Benefits

1. **Complete Separation**: Each project has entirely separate chat history
2. **Automatic Management**: No user configuration needed
3. **Seamless Switching**: Instant context switch when changing projects
4. **Memory Efficient**: Only active project's messages in memory
5. **Fresh Start**: Each project starts with empty chat history

### Persistence Integration

1. **Project-Aware Naming**: Files prefixed with project ID
2. **Filtered File Lists**: Only shows relevant chat files
3. **Consistent Format**: Same markdown format across all projects
4. **Error Handling**: Graceful fallbacks for save/load failures

## Troubleshooting

### Common Issues

1. **Context not updating**: Check if `updateChainMemory()` is called after edits
2. **UI not refreshing**: Ensure `notifyListeners()` is called after state changes
3. **Memory count mismatch**: Verify `truncateAfterMessageId()` updates chain memory
4. **Duplicate context badges**: Check React keys in MessageContext component
5. **Wrong project messages**: Check `getCurrentProjectId()` returns expected value
6. **Missing chat history**: Verify project ID in filename matches current project

### Debug Methods

```typescript
// Check message repository state
messageRepo.getDebugInfo();

// Check chat manager state
chatManager.getDebugInfo();

// Check LLM vs display message counts
console.log({
  display: chatUIState.getMessages().length,
  llm: chatManager.getLLMMessages().length,
});

// Check current project and repository
const debugInfo = chatManager.getDebugInfo();
console.log({
  currentProject: debugInfo.currentProjectId,
  totalProjects: debugInfo.projectCount,
  messagesByProject: debugInfo.messageCountByProject,
});
```

## Related Files

### Core Implementation

- `src/core/MessageRepository.ts` - Message storage
- `src/core/ChatManager.ts` - Business logic with project isolation
- `src/state/ChatUIState.ts` - UI state management
- `src/core/ContextManager.ts` - Context processing
- `src/core/ChatPersistenceManager.ts` - Chat history persistence

### React Integration

- `src/components/Chat.tsx` - Main chat component
- `src/hooks/useChatManager.ts` - React hook for ChatUIState
- `src/components/chat-components/ChatSingleMessage.tsx` - Message display

### Testing

- `src/core/MessageRepository.test.ts` - Repository tests
- `src/core/ChatManager.test.ts` - Manager tests
- `src/components/chat-components/MessageContext.test.tsx` - Context display tests
