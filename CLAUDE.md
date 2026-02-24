# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Copilot for Obsidian is an AI-powered assistant plugin that integrates various LLM providers (OpenAI, Anthropic, Google, etc.) with Obsidian. It provides chat interfaces, autocomplete, semantic search, and various AI-powered commands for note-taking and knowledge management.

## Development Commands

### Build & Development

- **NEVER RUN `npm run dev`** - The user will handle all builds manually
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

### Obsidian CLI (Live Testing)

The Obsidian desktop app includes a CLI for plugin development. Use the full path:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian <command>
```

**Plugin reload** (after `npm run build`):

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian plugin:reload id=copilot
```

**Console debugging** (requires attaching debugger first):

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian dev:debug on
/Applications/Obsidian.app/Contents/MacOS/obsidian dev:console limit=30
/Applications/Obsidian.app/Contents/MacOS/obsidian dev:console level=error limit=10
/Applications/Obsidian.app/Contents/MacOS/obsidian dev:errors
```

**Other useful dev commands**:

- `dev:dom selector=<css>` — Query DOM elements
- `dev:screenshot path=<file>` — Take a screenshot
- `eval code=<js>` — Execute JS in the app context
- `plugin:disable id=copilot` / `plugin:enable id=copilot`

Run `obsidian help` for the full command list.

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

For detailed architecture diagrams and documentation, see [`MESSAGE_ARCHITECTURE.md`](./docs/MESSAGE_ARCHITECTURE.md).

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
     - Creates new empty repository for each project (no message caching)

3. **ChatUIState** (`src/state/ChatUIState.ts`)

   - Clean UI-only state manager
   - Delegates all business logic to ChatManager
   - Provides React integration with subscription mechanism
   - Replaces legacy SharedState with minimal, focused approach

4. **ContextManager** (`src/core/ContextManager.ts`)

   - Handles context processing (notes, URLs, selected text)
   - Reprocesses context when messages are edited
   - Ensures fresh context for LLM processing

5. **ChatPersistenceManager** (`src/core/ChatPersistenceManager.ts`)
   - Handles saving and loading chat history to/from markdown files
   - Project-aware file naming (prefixes with project ID)
   - Parses and formats chat content for storage
   - Integrated with ChatManager for seamless persistence

## Code Style Guidelines

### MAJOR PRINCIPLES

- **ALWAYS WRITE GENERALIZABLE SOLUTIONS**: Never add edge-case handling or hardcoded logic for specific scenarios (like "piano notes" or "daily notes"). Solutions must work for all cases.
- **NEVER MODIFY AI PROMPT CONTENT**: Do not update, edit, or change any AI prompts, system prompts, or model adapter prompts unless explicitly asked to do so by the user
- **Avoid hardcoding**: No hardcoded folder names, file patterns, or special-case logic
- **Configuration over convention**: If behavior needs to vary, make it configurable, not hardcoded
- **Universal patterns**: Solutions should work equally well for any folder structure, naming convention, or content type

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
- **Always add JSDoc comments** for all functions and methods
- Organize imports: React → external → internal
- **Avoid language-specific lists** (like stopwords or action verbs) - use language-agnostic approaches instead

### Logging

- **NEVER use console.log** - Use the logging utilities instead:
  - `logInfo()` for informational messages
  - `logWarn()` for warnings
  - `logError()` for errors
- Import from logger: `import { logInfo, logWarn, logError } from "@/logger"`

### CSS & Styling

- **NEVER edit `styles.css` directly** - This is a generated file
- **Source file**: `src/styles/tailwind.css` - Edit this file for custom CSS
- **Build process**: `npm run build:tailwind` compiles `src/styles/tailwind.css` → `styles.css`
- **Tailwind classes**: Use Tailwind utility classes in components (see `tailwind.config.js` for available classes)
- **Custom CSS**: Add custom styles to `src/styles/tailwind.css` after the `@import` statements
- After editing CSS, always run `npm run build` to regenerate `styles.css`

## Testing Guidelines

- Unit tests use Jest with TypeScript support
- Mock Obsidian API for plugin testing
- Integration tests require API keys in `.env.test`
- Test files adjacent to implementation (`.test.ts`)
- Use `@testing-library/react` for component testing

### Avoiding Deep Dependency Chains in Tests

This codebase has deep transitive import chains (e.g. a utility → cache → searchUtils → embeddingManager → brevilabsClient → plusUtils → Modal). Importing any module in this chain from a test requires mocking the entire tree, which is brittle and verbose.

**Rules for new code:**

1. **Pass data, not services** — If a function only needs a string (like `outputFolder`), accept it as a parameter. Don't give it access to the entire settings singleton.
2. **Singletons at the edges only** — `getSettings()`, `PDFCache.getInstance()`, `BrevilabsClient.getInstance()` should only be called in top-level orchestration (constructors, main entry points). Inner functions receive what they need as parameters.
3. **Pure logic in leaf modules** — Extract testable logic into small files with minimal imports. The orchestration file (which has heavy imports) calls the leaf function and passes in the dependencies. See `src/tools/convertedDocOutput.ts` as an example.
4. **Litmus test before writing a function** — "Can I test this by calling it directly with plain arguments?" If the answer is no because of an import, that dependency should be a parameter instead.

## Development Session Planning

### Using TODO.md for Session Management

**IMPORTANT**: When working on a development session, maintain a comprehensive `TODO.md` file that serves as the central plan and tracker:

1. **Session Goal**: Define the high-level objective at the start
2. **Task Tracking**:
   - List all completed tasks with [x] checkboxes
   - Track pending tasks with [ ] checkboxes
   - Group related tasks into logical sections
3. **Architecture Decisions**: Document key design choices and rationale
4. **Progress Updates**: Keep the TODO.md updated as tasks complete
5. **Testing Checklist**: Include verification steps for the session

The TODO.md should be:

- The single source of truth for session progress
- Updated frequently as work progresses
- Clear enough that another developer can understand what was done
- Comprehensive enough to serve as a migration guide

### Structure Example:

```markdown
# Development Session TODO

## Session Goal

[Clear statement of what this session aims to achieve]

## Completed Tasks ✅

- [x] Task description with key details
- [x] Another completed task

## Pending Tasks 📋

- [ ] Next task to work on
- [ ] Future enhancement

## Architecture Summary

[Key design decisions and rationale]

## Testing Checklist

- [ ] Functionality verification
- [ ] Performance checks
```

## Important Notes

- The plugin supports multiple LLM providers with custom endpoints
- Vector store requires rebuilding when switching embedding providers
- Settings are versioned - migrations may be needed
- Local model support available via Ollama/LM Studio
- Rate limiting is implemented for all API calls
- For technical debt and known issues, see [`TECHDEBT.md`](./docs/TECHDEBT.md)
- For current development session planning, see [`TODO.md`](./TODO.md)

### AWS Bedrock Usage

**IMPORTANT**: When using AWS Bedrock, always use **cross-region inference profile IDs** for better reliability and availability:

- **Global** (recommended): `global.anthropic.claude-sonnet-4-5-20250929-v1:0`
  - Routes to any commercial AWS region automatically
  - Best for reliability and performance
- **US**: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- **EU**: `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`
- **APAC**: `apac.anthropic.claude-sonnet-4-5-20250929-v1:0`

❌ **Avoid regional model IDs** (without prefix): `anthropic.claude-sonnet-4-5-20250929-v1:0`

- These only work in specific regions and often fail
- Not recommended for production use

**References:**

- [AWS Bedrock Cross-Region Inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)
- [Supported Inference Profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)

### Obsidian Plugin Environment

- **Global `app` variable**: In Obsidian plugins, `app` is a globally available variable that provides access to the Obsidian API. It's automatically available in all files without needing to import or declare it.

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
- Check @tailwind.config.js to understand what tailwind css classnames are available
