# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Copilot for Obsidian is an AI-powered assistant plugin that integrates various LLM providers (OpenAI, Anthropic, Google, etc.) with Obsidian. It provides chat interfaces, autocomplete, semantic search, and various AI-powered commands for note-taking and knowledge management.

## Development Commands

### Build & Development

- `npm run dev` - Start development server with hot reload (runs Tailwind CSS + esbuild in watch mode)
- `npm run build` - Production build (TypeScript check + minified output)

### Code Quality

- `npm run lint` - Run ESLint checks
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check formatting without changing files
- **Before PR:** Always run `npm run format && npm run lint`

### Testing

- `npm run test` - Run unit tests (excludes integration tests)
- `npm run test:integration` - Run integration tests (requires API keys)
- Run single test: `npm test -- -t "test name"`

## High-Level Architecture

### Core Systems

1. **LLM Provider System** (`src/LLMProviders/`)

   - Provider implementations for OpenAI, Anthropic, Google, Azure, local models
   - `LLMProviderManager` handles provider lifecycle and switching
   - Stream-based responses with error handling and rate limiting
   - Custom model configuration support

2. **Chain Factory Pattern** (`src/chainFactory.ts`)

   - Different chain types for various AI operations (chat, copilot, adhoc prompts)
   - LangChain integration for complex workflows
   - Memory management for conversation context
   - Tool integration (search, file operations, time queries)

3. **Vector Store & Search** (`src/search/`)

   - `VectorStoreManager` manages embeddings and semantic search
   - `ChunkedStorage` for efficient large document handling
   - Event-driven index updates via `IndexManager`
   - Multiple embedding providers support

4. **UI Component System** (`src/components/`)

   - React functional components with Radix UI primitives
   - Tailwind CSS with class variance authority (CVA)
   - Modal system for user interactions
   - Chat interface with streaming support
   - Settings UI with versioned components

5. **Message Management Architecture** (`src/core/`, `src/state/`)

   - **MessageRepository** (`src/core/MessageRepository.ts`): Single source of truth for all messages
     - Stores each message once with both `displayText` and `processedText`
     - Provides computed views for UI display and LLM processing
     - No complex dual-array synchronization
   - **ChatManager** (`src/core/ChatManager.ts`): Central business logic coordinator
     - Orchestrates MessageRepository, ContextManager, and LLM operations
     - Handles message sending, editing, regeneration, and deletion
     - Manages context processing and chain memory synchronization
     - **Project Chat Isolation**: Maintains separate MessageRepository per project
       - Automatically detects project switches via `getCurrentMessageRepo()`
       - Each project has its own isolated message history
       - Non-project chats use `defaultProjectKey` repository
   - **ChatUIState** (`src/state/ChatUIState.ts`): Clean UI-only state manager
     - Delegates all business logic to ChatManager
     - Provides React integration with subscription mechanism
     - Replaces legacy SharedState with minimal, focused approach
   - **ContextManager** (`src/core/ContextManager.ts`): Handles context processing
     - Processes message context (notes, URLs, selected text)
     - Reprocesses context when messages are edited

6. **Settings Management**

   - Jotai for atomic settings state management
   - React contexts for feature-specific state

7. **Plugin Integration**
   - Main entry: `src/main.ts` extends Obsidian Plugin
   - Command registration system
   - Event handling for Obsidian lifecycle
   - Settings persistence and migration
   - Chat history loading via pending message mechanism

### Key Patterns

- **Single Source of Truth**: MessageRepository stores each message once with computed views
- **Clean Architecture**: Repository → Manager → UIState → React Components
- **Context Reprocessing**: Automatic context updates when messages are edited
- **Computed Views**: Display messages for UI, LLM messages for AI processing
- **Project Isolation**: Each project maintains its own MessageRepository instance
- **Error Handling**: Custom error types with detailed interfaces
- **Async Operations**: Consistent async/await pattern with proper error boundaries
- **Caching**: Multi-layer caching for files, PDFs, and API responses
- **Streaming**: Real-time streaming for LLM responses
- **Testing**: Unit tests adjacent to implementation, integration tests for API calls

## Message Management Architecture

### Core Classes and Flow

1. **MessageRepository** (`src/core/MessageRepository.ts`)

   - Single source of truth for all messages
   - Stores `StoredMessage` objects with both `displayText` and `processedText`
   - Provides computed views via `getDisplayMessages()` and `getLLMMessages()`
   - No complex dual-array synchronization or ID matching

2. **ChatManager** (`src/core/ChatManager.ts`)

   - Central business logic coordinator
   - Orchestrates MessageRepository, ContextManager, and LLM operations
   - Handles all message CRUD operations with proper error handling
   - Synchronizes with chain memory for conversation history
   - **Project Chat Isolation Implementation**:
     - Maintains `projectMessageRepos: Map<string, MessageRepository>` for project-specific storage
     - `getCurrentMessageRepo()` automatically detects current project and returns correct repository
     - Seamlessly switches between project repositories when project changes
     - Loads existing messages from ProjectManager cache when creating new repository

3. **ChatUIState** (`src/state/ChatUIState.ts`)

   - Clean UI-only state manager
   - Delegates all business logic to ChatManager
   - Provides React integration with subscription mechanism
   - Replaces legacy SharedState with minimal, focused approach

4. **ContextManager** (`src/core/ContextManager.ts`)
   - Handles context processing (notes, URLs, selected text)
   - Reprocesses context when messages are edited
   - Ensures fresh context for LLM processing

### Message Flow

1. **Sending Messages**: User → ChatUIState → ChatManager → MessageRepository + ContextManager
2. **Display**: MessageRepository.getDisplayMessages() → ChatUIState → React Components
3. **LLM Processing**: MessageRepository.getLLMMessages() → Chain Memory → LLM Providers
4. **Editing**: ChatUIState → ChatManager → MessageRepository + ContextManager (reprocessing)

### Testing

- Comprehensive unit tests for MessageRepository and ChatManager
- Bug prevention tests for critical issues (context badges, memory sync, edit behavior)
- Integration tests for React components
- All tests use Jest with proper mocking

## Code Style Guidelines

### TypeScript

- Strict mode enabled (no implicit any, strict null checks)
- Use absolute imports with `@/` prefix: `import { ChainType } from "@/chainFactory"`
- Prefer const assertions and type inference where appropriate
- Use interface for object shapes, type for unions/aliases

### React

- Functional components only (no class components)
- Custom hooks for reusable logic
- Props interfaces defined above components
- Avoid inline styles, use Tailwind classes

### General

- File naming: PascalCase for components, camelCase for utilities
- Async/await over promises
- Early returns for error conditions
- JSDoc for complex functions
- Organize imports: React → external → internal

## Testing Guidelines

- Unit tests use Jest with TypeScript support
- Mock Obsidian API for plugin testing
- Integration tests require API keys in `.env.test`
- Test files adjacent to implementation (`.test.ts`)
- Use `@testing-library/react` for component testing

### Manual Test Checklists

**Important**: After each significant change, generate a manual test checklist document that includes:

1. **Overview**: Brief description of what changed
2. **Test Scenarios**: Specific test cases with steps and expected results
3. **Verification Checklist**: List of items to verify functionality
4. **Files Modified**: List of changed files for reference

Example format:

```markdown
# [Feature] Test Instructions

## Overview

Brief description of the feature/fix

## Test Scenarios

### 1. Test Case Name

1. Step one
2. Step two
3. **Expected Result:**
   - Expected behavior
   - UI state changes
   - Data persistence

### 2. Another Test Case

[...]

## Verification Checklist

- [ ] Core functionality works
- [ ] Edge cases handled
- [ ] No regressions
- [ ] Performance acceptable
```

This helps ensure thorough testing and provides documentation for QA.

## Important Notes

- The plugin supports multiple LLM providers with custom endpoints
- Vector store requires rebuilding when switching embedding providers
- Settings are versioned - migrations may be needed
- Local model support available via Ollama/LM Studio
- Rate limiting is implemented for all API calls

### Architecture Migration Notes

- **SharedState Removed**: The legacy `src/sharedState.ts` has been completely removed
- **Clean Architecture**: New architecture follows Repository → Manager → UIState → UI pattern
- **Single Source of Truth**: All messages stored once in MessageRepository with computed views
- **Context Always Fresh**: Context is reprocessed when messages are edited to ensure accuracy
- **Chat History Loading**: Uses pending message mechanism through CopilotView → Chat component props
- **Project Chat Isolation**: Each project now has completely isolated chat history
  - Automatic detection of project switches via `ProjectManager.getCurrentProjectId()`
  - Separate MessageRepository instances per project ID
  - Non-project chats stored in default repository
  - Backwards compatible - loads existing messages from ProjectManager cache
  - Zero configuration required - works automatically
