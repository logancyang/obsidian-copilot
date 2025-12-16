# Chain Runner Architecture & Tool Calling System

This directory contains the refactored chain runner system for Obsidian Copilot, providing multiple chain execution strategies with different tool calling approaches.

## Overview

The chain runner system provides two distinct tool calling approaches:

1. **Legacy Tool Calling** (CopilotPlusChainRunner) - Uses Brevilabs API for intent analysis
2. **Autonomous Agent** (AutonomousAgentChainRunner) - Uses XML-based tool calling

## Architecture

```
chainRunner/
├── BaseChainRunner.ts                 # Abstract base class with shared functionality
├── LLMChainRunner.ts                  # Basic LLM interaction (no tools)
├── VaultQAChainRunner.ts              # Vault-only Q&A with retrieval
├── CopilotPlusChainRunner.ts          # Legacy tool calling system
├── ProjectChainRunner.ts              # Project-aware extension of Plus
├── AutonomousAgentChainRunner.ts   # XML-based autonomous agent tool calling
├── index.ts                           # Main exports
└── utils/
    ├── ThinkBlockStreamer.ts          # Handles thinking content from models
    ├── xmlParsing.ts                  # XML tool call parsing utilities
    ├── toolExecution.ts               # Tool execution helpers
    └── modelAdapter.ts                # Model-specific adaptations
```

## Tool Calling Systems Comparison

### 1. Model-Based Tool Planning (CopilotPlusChainRunner)

**How it works:**

- Uses chat model with tool descriptions to plan which tools to call
- Model outputs tool calls in XML format (e.g., `<use_tool><name>...</name><args>...</args></use_tool>`)
- Executes tools synchronously before sending to LLM for final response
- Enhances user message with tool outputs as context
- Supports `@` commands for explicit tool invocation (`@vault`, `@websearch`, `@memory`)

**Flow:**

```
User Message → Model Planning → Tool Execution → Enhanced Prompt → LLM Response
```

**Example:**

```typescript
// 1. Plan tools using model
const { toolCalls, salientTerms } = await this.planToolCalls(message, chatModel);

// 2. Process @commands (add localSearch, webSearch, etc. if needed)
toolCalls = await this.processAtCommands(message, toolCalls, { salientTerms });

// 3. Execute tools
const toolOutputs = await this.executeToolCalls(toolCalls);

// 4. Send to LLM
const response = await this.streamMultimodalResponse(message, toolOutputs, ...);
```

**Tools Available:**

- `localSearch` - Search vault content
- `webSearch` - Search the web
- `getCurrentTime` - Get current time
- `getFileTree` - Get file structure
- `pomodoroTool` - Pomodoro timer
- `youtubeTranscription` - YouTube video transcription

### 2. Autonomous Agent (AutonomousAgentChainRunner)

**How it works:**

- **No LangChain dependency** - Uses simple tool interface with XML-based tool calling
- AI decides autonomously which tools to use via structured XML format
- Iterative loop where AI can call multiple tools in sequence
- Each tool result informs the next decision

**Flow:**

```
User Message → AI Reasoning → XML Tool Call → Tool Execution →
AI Analysis → More Tools? → Final Response
```

**XML Tool Call Format:**

```xml
<use_tool>
<name>localSearch</name>
<args>
{
  "query": "machine learning notes",
  "salientTerms": ["machine", "learning", "AI", "algorithms"]
}
</args>
</use_tool>
```

**Sequential Loop:**

```typescript
while (iteration < maxIterations) {
  // 1. Get AI response
  const response = await this.streamResponse(messages);

  // 2. Parse XML tool calls
  const toolCalls = parseXMLToolCalls(response);

  if (toolCalls.length === 0) {
    // No tools needed - final response
    break;
  }

  // 3. Execute each tool
  for (const toolCall of toolCalls) {
    const result = await executeSequentialToolCall(toolCall, availableTools);
    toolResults.push(result);
  }

  // 4. Add results to conversation for next iteration
  messages.push({ role: "user", content: toolResultsForConversation });
}
```

## Key Differences

| Aspect             | Legacy (Plus)           | Autonomous Agent                      |
| ------------------ | ----------------------- | ------------------------------------- |
| **Tool Decision**  | Brevilabs API analysis  | AI decides autonomously               |
| **Tool Execution** | Pre-LLM, synchronous    | During conversation, iterative        |
| **Tool Format**    | SimpleTool interface    | XML-based structured format           |
| **Reasoning**      | Intent analysis → tools | AI reasoning → tools → more reasoning |
| **Iterations**     | Single pass             | Up to 4 iterations                    |
| **Tool Chaining**  | Limited                 | Full chaining support                 |

## SimpleTool Interface

### Overview

The SimpleTool interface provides a clean, type-safe way to define tools with Zod validation:

```typescript
interface SimpleTool<TSchema extends z.ZodType = z.ZodVoid> {
  name: string;
  description: string;
  schema: TSchema;
  call: (args: z.infer<TSchema>) => Promise<any>;
  timeoutMs?: number;
  isBackground?: boolean;
}
```

### Creating Tools

All tools are created using the unified `createTool` function with Zod schemas:

#### Tool with No Parameters

```typescript
const indexTool = createTool({
  name: "indexVault",
  description: "Index the vault to the Copilot index",
  schema: z.void(), // No parameters
  handler: async () => {
    // Tool implementation
    return "Indexing complete";
  },
  isBackground: true, // Optional: hide from user
});
```

#### Tool with Parameters

```typescript
// Define schema with validation rules
const searchSchema = z.object({
  query: z.string().min(1).describe("The search query"),
  salientTerms: z.array(z.string()).min(1).describe("Key terms extracted from query"),
  timeRange: z
    .object({
      startTime: z.any(),
      endTime: z.any(),
    })
    .optional()
    .describe("Time range for search"),
});

// Create tool with automatic validation
const searchTool = createTool({
  name: "localSearch",
  description: "Search for notes based on query and time range",
  schema: searchSchema,
  handler: async ({ query, salientTerms, timeRange }) => {
    // Handler receives fully typed and validated arguments
    // TypeScript knows the exact types from the schema
    return performSearch(query, salientTerms, timeRange);
  },
  timeoutMs: 30000, // Optional: custom timeout
});
```

### Benefits of Unified Zod Approach

1. **Type Safety**: Full TypeScript type inference from schemas
2. **Runtime Validation**: All inputs validated before reaching handler
3. **Consistent Interface**: One way to create all tools
4. **Better Error Messages**: Zod provides detailed validation errors
5. **No Any Types**: Everything is properly typed
6. **Simpler Codebase**: No need to maintain multiple tool creation methods

### Advanced Zod Patterns

#### Complex Validation

```typescript
const emailToolSchema = z.object({
  to: z.string().email().describe("Recipient email"),
  subject: z.string().min(1).max(100).describe("Email subject"),
  body: z.string().min(1).describe("Email content"),
  cc: z.array(z.string().email()).optional().describe("CC recipients"),
});
```

#### Union Types for Actions

```typescript
const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("search"),
    query: z.string().min(1),
  }),
  z.object({
    type: z.literal("create"),
    content: z.string().min(1),
    tags: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal("delete"),
    id: z.string().uuid(),
  }),
]);

const actionTool = createTool({
  name: "performAction",
  description: "Perform various actions",
  schema: actionSchema,
  handler: async (action) => {
    // TypeScript knows exactly which type based on discriminator
    switch (action.type) {
      case "search":
        return search(action.query);
      case "create":
        return create(action.content, action.tags);
      case "delete":
        return deleteItem(action.id);
    }
  },
});
```

#### Custom Validation

```typescript
const filePathSchema = z
  .string()
  .refine((val) => val.endsWith(".md") || val.endsWith(".canvas"), {
    message: "File must be .md or .canvas",
  })
  .refine((val) => !val.includes(".."), { message: "Path traversal not allowed" })
  .describe("Path to markdown or canvas file");
```

#### Transformations

```typescript
const dateToolSchema = z.object({
  date: z
    .string()
    .describe("Date in ISO format or natural language")
    .transform((str) => new Date(str)),
  timezone: z.string().default("UTC").describe("Timezone identifier"),
});
```

### Schema Composition

```typescript
// Base schemas that can be reused
const timeRangeSchema = z
  .object({
    startTime: z.date(),
    endTime: z.date(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "End time must be after start time",
  });

const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

// Compose into larger schemas
const searchWithPaginationSchema = z.object({
  query: z.string().min(1).describe("Search query"),
  filters: z.record(z.string()).optional().describe("Additional filters"),
  timeRange: timeRangeSchema.optional(),
  pagination: paginationSchema,
});
```

### Default Values

```typescript
const configSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(1000),
  model: z.enum(["gpt-4", "gpt-3.5-turbo"]).default("gpt-4"),
});

// Handler receives object with defaults applied
const configTool = createTool({
  name: "updateConfig",
  schema: configSchema,
  handler: async (config) => {
    // config.temperature is always defined (0.7 if not provided)
    // config.maxTokens is always defined (1000 if not provided)
    // config.model is always defined ("gpt-4" if not provided)
    return updateConfiguration(config);
  },
});
```

### Handling Validation Errors with Retry

When AI-generated parameters fail Zod validation, the tool execution will return a formatted error. The autonomous agent automatically handles this through its iterative loop:

```typescript
// Example tool with strict validation
const searchToolWithValidation = createTool({
  name: "searchNotes",
  description: "Search notes with specific criteria",
  schema: z.object({
    query: z.string().min(2, "Query must be at least 2 characters"),
    limit: z.number().int().min(1).max(100),
    sortBy: z.enum(["relevance", "date", "title"]),
  }),
  handler: async ({ query, limit, sortBy }) => {
    return performSearch(query, limit, sortBy);
  },
});

// When the AI provides invalid parameters:
// Input: { query: "a", limit: 200, sortBy: "random" }
//
// The flow:
// 1. Tool execution catches Zod validation error
// 2. Returns: "Tool searchNotes validation failed: query: Query must be at least 2 characters,
//             limit: Number must be less than or equal to 100, sortBy: Invalid enum value"
// 3. This error is added to the conversation as a user message
// 4. The AI sees the error in the next iteration and can retry with corrected parameters
// 5. The autonomous agent continues up to 4 iterations, allowing multiple retry attempts

// Example conversation flow:
// Iteration 1: AI calls tool with invalid params → receives error
// Iteration 2: AI understands error and retries with { query: "search term", limit: 50, sortBy: "date" } → success
```

The validation errors are automatically formatted to be clear and actionable, helping the AI self-correct. The autonomous agent's iterative design naturally provides retry capability with the AI learning from each error.

## XML Tool Calling Details

### Tool Call Parsing (`xmlParsing.ts`)

```typescript
// Parse XML tool calls from AI response
function parseXMLToolCalls(text: string): ToolCall[] {
  const regex = /<use_tool>([\s\S]*?)<\/use_tool>/g;
  // Extracts name and args from XML structure
}

// Strip tool calls from display
function stripToolCallXML(text: string): string {
  // Removes XML tool blocks and code blocks for clean display
}
```

### Tool Execution (`toolExecution.ts`)

```typescript
// Execute individual tool with timeout and error handling
async function executeSequentialToolCall(
  toolCall: ToolCall,
  availableTools: any[]
): Promise<ToolExecutionResult> {
  // 30-second timeout per tool
  // Error handling and validation
  // Result formatting
}
```

### Available Tools in Sequential Mode

All tools from the legacy system plus autonomous decision-making:

- **localSearch** - Vault content search with salient terms
- **webSearch** - Web search with chat history context
- **getFileTree** - File structure exploration
- **getCurrentTime** - Time-based queries
- **pomodoroTool** - Productivity timer
- **indexTool** - Vault indexing operations
- **youtubeTranscription** - Video content analysis

### System Prompt Engineering

The Autonomous Agent mode uses a comprehensive system prompt that:

1. **Explains the XML format** with exact examples
2. **Provides tool descriptions** with parameter details
3. **Sets expectations** for reasoning and tool chaining
4. **Includes critical requirements** (e.g., salientTerms for localSearch)

Example system prompt section:

```
When you need to use a tool, format it EXACTLY like this:
<use_tool>
<name>localSearch</name>
<args>
{
  "query": "piano learning",
  "salientTerms": ["piano", "learning", "practice", "music"]
}
</args>
</use_tool>

CRITICAL: For localSearch, you MUST always provide both "query" (string) and "salientTerms" (array of strings).
```

## Benefits of Autonomous Agent

1. **Autonomous Tool Selection** - AI decides what tools to use without pre-analysis
2. **Tool Chaining** - Can use results from one tool to inform the next
3. **Complex Workflows** - Multi-step reasoning with tool support
4. **Model Agnostic** - Works with any LLM that can follow XML format
5. **No External Dependencies** - No Brevilabs API required
6. **Transparency** - User can see the AI's reasoning process

## Usage

### Enable Autonomous Agent

```typescript
// In settings
settings.enableAutonomousAgent = true;

// ChainManager automatically selects the appropriate runner
const runner = chainManager.getChainRunner(); // Returns AutonomousAgentChainRunner
```

### Example Query Flow

**User Input:** "Find my notes about machine learning and research current best practices"

**Autonomous Agent Process:**

1. **Iteration 1**: AI reasons about the task → calls `localSearch` for ML notes
2. **Iteration 2**: Analyzes vault results → calls `webSearch` for current practices
3. **Iteration 3**: Synthesizes both sources → provides comprehensive response

**Legacy Process:**

1. Intent analysis determines both tools needed
2. Executes both tools
3. Single LLM call with all context

## Error Handling & Fallbacks

### Autonomous Agent Fallbacks

```typescript
try {
  // Sequential thinking execution
} catch (error) {
  // Automatic fallback to CopilotPlusChainRunner
  const fallbackRunner = new CopilotPlusChainRunner(this.chainManager);
  return await fallbackRunner.run(/* same parameters */);
}
```

### Tool Execution Safeguards

- 30-second timeout per tool
- Graceful error handling with descriptive messages
- Tool availability validation
- Result validation and formatting

## Model Adapter Pattern

### Overview

The Model Adapter pattern handles model-specific quirks and requirements cleanly, keeping the core logic model-agnostic.

### Architecture

```typescript
interface ModelAdapter {
  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string;
  enhanceUserMessage(message: string, requiresTools: boolean): string;
  parseToolCalls?(response: string): any[]; // Future extension
  needsSpecialHandling(): boolean;
  sanitizeResponse?(response: string, iteration: number): string;
  shouldTruncateStreaming?(partialResponse: string): boolean;
  detectPrematureResponse?(response: string): {
    hasPremature: boolean;
    type: "before" | "after" | null;
  };
}
```

### Current Adapters

1. **BaseModelAdapter** - Default behavior for well-behaved models
2. **GPTModelAdapter** - Aggressive prompting for GPT models that often skip tool calls
3. **ClaudeModelAdapter** - Specialized handling for Claude thinking models (3.7 Sonnet, Claude 4)
4. **GeminiModelAdapter** - Ready for Gemini-specific handling

### Adding a New Model

```typescript
class NewModelAdapter extends BaseModelAdapter {
  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string {
    const base = super.enhanceSystemPrompt(basePrompt, toolDescriptions);
    return base + "\n\n[Model-specific instructions here]";
  }

  enhanceUserMessage(message: string, requiresTools: boolean): string {
    // Add model-specific hints if needed
    return requiresTools ? `${message}\n[Model-specific hint]` : message;
  }
}

// Register in ModelAdapterFactory
if (modelName.includes("newmodel")) {
  return new NewModelAdapter(modelName);
}
```

### Claude Model Adapter Features

The `ClaudeModelAdapter` includes specialized handling for Claude thinking models:

#### Thinking Model Support

- **Claude 3.7 Sonnet** and **Claude 4** - Automatic thinking mode configuration
- **Think Block Preservation** - Maintains valuable reasoning context in responses
- **Temperature Control** - Disables temperature for thinking models (as required by API)

#### Claude 4 Hallucination Prevention

Claude 4 has a tendency to write complete responses immediately after tool calls instead of waiting for results. The adapter addresses this with:

```typescript
// Enhanced prompting with explicit autonomous agent pattern
enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string {
  if (this.isClaudeSonnet4()) {
    // Add specific instructions for Claude 4:
    // - Brief sentence + tool calls + STOP pattern
    // - Explicit warnings about premature responses
    // - Clear autonomous agent iteration guidance
  }
}

// Detection of premature responses
detectPrematureResponse(response: string): {
  hasPremature: boolean;
  type: "before" | "after" | null;
} {
  // Allows brief sentences before tool calls (up to 2 sentences, 200 chars)
  // Detects substantial content after tool calls (forbidden)
  // Uses threshold-based detection for generalizability
}

// Response sanitization
sanitizeResponse(response: string, iteration: number): string {
  // Preserves ALL think blocks
  // Removes substantial non-thinking content after tool calls
  // Only applies to first iteration when hallucination occurs
}

// Streaming truncation
shouldTruncateStreaming(partialResponse: string): boolean {
  // Prevents streaming of hallucinated content to users
  // Truncates at last complete tool call when threshold exceeded
}
```

#### Flow Improvement

The adapter creates a better conversational flow by allowing brief explanatory sentences before tool calls:

```
[Think block]
I'll search your vault and web for piano practice information.
🔍 Calling vault search...
[Think block]
Let me gather more specific information about practice routines.
🌐 Calling web search...
[Think block]
[final answer]
```

### Benefits

1. **Separation of Concerns** - Model quirks isolated from core logic
2. **Maintainability** - Easy to find and update model-specific code
3. **Extensibility** - Simple to add support for new models
4. **Testing** - Model adapters can be unit tested independently
5. **Clean Core** - Autonomous agent logic remains model-agnostic
6. **Hallucination Prevention** - Specialized handling for problematic models
7. **Streaming Protection** - Prevents bad content from reaching users
8. **Generalizable Solutions** - Uses threshold-based detection over regex patterns

## Future Considerations

1. **Tool Discovery** - Dynamic tool registration
2. **Custom Tools** - User-defined tool capabilities
3. **Parallel Execution** - Multiple tools simultaneously
4. **Tool Result Caching** - Avoid redundant calls
5. **Advanced Reasoning** - More sophisticated decision trees
6. **Tool Permissions** - User control over tool access
7. **Alternative Parsing** - Model adapters could handle non-XML formats
8. **Response Validation** - Adapters could validate model outputs
9. **Model-Specific Optimizations** - Expand adapter capabilities for emerging models
10. **Hallucination Detection** - More sophisticated premature response detection

The autonomous agent approach represents a significant evolution from traditional tool calling, enabling more sophisticated AI reasoning and autonomous task completion.
