# Chain Runner Architecture & Tool Calling System

This directory contains the refactored chain runner system for Obsidian Copilot, providing multiple chain execution strategies with different tool calling approaches.

## Overview

The chain runner system provides two distinct tool calling approaches:

1. **Legacy Tool Calling** (CopilotPlusChainRunner) - Uses Brevilabs API for intent analysis
2. **Autonomous Agent** (AutonomousAgentChainRunner) - Uses XML-based tool calling inspired by Cline

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

### 1. Legacy Tool Calling (CopilotPlusChainRunner)

**How it works:**

- Uses Brevilabs API (`IntentAnalyzer.analyzeIntent()`) to analyze user intent
- Determines which tools to call based on the analysis
- Executes tools synchronously before sending to LLM
- Enhances user message with tool outputs as context

**Flow:**

```
User Message → Intent Analysis → Tool Execution → Enhanced Prompt → LLM Response
```

**Example:**

```typescript
// 1. Analyze intent
const toolCalls = await IntentAnalyzer.analyzeIntent(message);

// 2. Execute tools
const toolOutputs = await this.executeToolCalls(toolCalls);

// 3. Enhance message with context
const enhancedMessage = this.prepareEnhancedUserMessage(message, toolOutputs);

// 4. Send to LLM
const response = await this.streamMultimodalResponse(enhancedMessage, ...);
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

- **No LangChain tool calling system** - Uses XML-based tool calling
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
| **Tool Format**    | LangChain tool objects  | XML-based structured format           |
| **Reasoning**      | Intent analysis → tools | AI reasoning → tools → more reasoning |
| **Iterations**     | Single pass             | Up to 4 iterations                    |
| **Tool Chaining**  | Limited                 | Full chaining support                 |

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
}
```

### Current Adapters

1. **BaseModelAdapter** - Default behavior for well-behaved models
2. **GPTModelAdapter** - Aggressive prompting for GPT models
3. **ClaudeModelAdapter** - Ready for Claude-specific customizations
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

### Benefits

1. **Separation of Concerns** - Model quirks isolated from core logic
2. **Maintainability** - Easy to find and update model-specific code
3. **Extensibility** - Simple to add support for new models
4. **Testing** - Model adapters can be unit tested independently
5. **Clean Core** - Sequential thinking logic remains model-agnostic

## Future Considerations

1. **Tool Discovery** - Dynamic tool registration
2. **Custom Tools** - User-defined tool capabilities
3. **Parallel Execution** - Multiple tools simultaneously
4. **Tool Result Caching** - Avoid redundant calls
5. **Advanced Reasoning** - More sophisticated decision trees
6. **Tool Permissions** - User control over tool access
7. **Alternative Parsing** - Model adapters could handle non-XML formats
8. **Response Validation** - Adapters could validate model outputs

The autonomous agent approach represents a significant evolution from traditional tool calling, enabling more sophisticated AI reasoning and autonomous task completion.
