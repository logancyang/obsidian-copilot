# Message Architecture & Context Design

This document describes the new message management and context processing architecture that replaced the legacy SharedState system. The new design follows clean architecture principles with a single source of truth and computed views.

## Architecture Principles

### Single Source of Truth

- Each message is stored exactly once in `MessageRepository`
- All UI and LLM views are computed from this single storage
- No complex dual-array synchronization or ID matching

### Clean Architecture Flow

```
User Input → ChatUIState → ChatManager → MessageRepository + ContextManager
                ↓
UI Components ← ChatUIState ← Computed Views ← MessageRepository
                ↓
LLM Processing ← Chain Memory ← getLLMMessages() ← MessageRepository
```

### Context Always Fresh

- Context is reprocessed when messages are edited
- No stale context issues from cached processing
- Ensures accurate context for LLM interactions

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

// Notify React components of changes
private notifyListeners(): void
```

### 4. ContextManager (`src/core/ContextManager.ts`)

**Purpose**: Handles context processing and reprocessing

**Key Features**:

- Processes message context (notes, URLs, selected text)
- Reprocesses context when messages are edited
- Ensures fresh context for LLM processing

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
MessageRepository.getDisplayMessages() // Computed view
    ↓
Filter visible messages → Map to ChatMessage format
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

## Future Considerations

### Extensibility

- Easy to add new message types via StoredMessage interface
- Context processing can be extended without affecting storage
- Clean separation allows for new UI patterns

### Persistence

- Single source of truth simplifies persistence logic
- MessageRepository can be easily backed by different storage mechanisms
- Chat history format remains stable

## Troubleshooting

### Common Issues

1. **Context not updating**: Check if `updateChainMemory()` is called after edits
2. **UI not refreshing**: Ensure `notifyListeners()` is called after state changes
3. **Memory count mismatch**: Verify `truncateAfterMessageId()` updates chain memory
4. **Duplicate context badges**: Check React keys in MessageContext component

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
```

## Related Files

### Core Implementation

- `src/core/MessageRepository.ts` - Message storage
- `src/core/ChatManager.ts` - Business logic
- `src/state/ChatUIState.ts` - UI state management
- `src/core/ContextManager.ts` - Context processing

### React Integration

- `src/components/Chat.tsx` - Main chat component
- `src/hooks/useChatManager.ts` - React hook for ChatUIState
- `src/components/chat-components/ChatSingleMessage.tsx` - Message display

### Testing

- `src/core/MessageRepository.test.ts` - Repository tests
- `src/core/ChatManager.test.ts` - Manager tests
- `src/components/chat-components/MessageContext.test.tsx` - Context display tests
