# BedrockChatModel Tool Calling Implementation

## Status: ✅ IMPLEMENTED

Native tool/function calling support has been added to the custom `BedrockChatModel` class for Agent mode.

---

## Summary

The `BedrockChatModel` now supports LangChain's native tool calling via `model.bindTools(tools)`, enabling it to work with Agent mode just like `ChatOpenAI`, `ChatAnthropic`, and `ChatGoogleGenerativeAI`.

---

## Implementation Details

### 1. `bindTools()` Method

```typescript
bindTools(tools: StructuredToolInterface[]): BedrockChatModel {
  const bound = Object.create(this) as BedrockChatModel;
  bound.boundTools = tools;
  return bound;
}
```

Creates a new instance with tools bound, following LangChain's pattern.

### 2. Tool Format Conversion

```typescript
private convertToolsToClaude(tools: StructuredToolInterface[]): any[] {
  return tools.map((tool) => {
    let inputSchema: any = { type: "object", properties: {} };
    if (tool.schema) {
      inputSchema = isInteropZodSchema(tool.schema)
        ? toJsonSchema(tool.schema)
        : tool.schema;
    }
    return {
      name: tool.name,
      description: tool.description || "",
      input_schema: inputSchema,
    };
  });
}
```

Uses LangChain's `isInteropZodSchema` and `toJsonSchema` for proper schema conversion.

### 3. Request Body with Tools

Tools are included in the request payload when bound:

```typescript
if (this.boundTools && this.boundTools.length > 0) {
  payload.tools = this.convertToolsToClaude(this.boundTools);
}
```

### 4. ToolMessage Handling

`buildRequestBody` handles `ToolMessage` (tool results) as `tool_result` content blocks:

```typescript
if (messageType === "tool") {
  const toolMessage = message as ToolMessage;
  conversation.push({
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: toolMessage.tool_call_id,
        content: toolResultContent,
      },
    ],
  });
}
```

### 5. AIMessage with Tool Calls

`buildRequestBody` handles `AIMessage` with `tool_calls` as `tool_use` content blocks:

```typescript
if (toolCalls && toolCalls.length > 0) {
  const contentBlocks: ContentBlock[] = [];
  // Add text if present
  // Add tool_use blocks for each tool call
  for (const tc of toolCalls) {
    contentBlocks.push({
      type: "tool_use",
      id: tc.id || `tool_${Date.now()}`,
      name: tc.name,
      input: tc.args as Record<string, unknown>,
    });
  }
}
```

### 6. Non-Streaming Tool Call Extraction

`_generate` extracts tool calls from Claude's response:

```typescript
private extractToolCalls(data: any): any[] | undefined {
  if (!Array.isArray(data?.content)) return undefined;
  const toolUseBlocks = data.content.filter(
    (block: any) => block.type === "tool_use"
  );
  if (toolUseBlocks.length === 0) return undefined;
  return toolUseBlocks.map((block: any) => ({
    id: block.id,
    name: block.name,
    args: block.input || {},
    type: "tool_call" as const,
  }));
}
```

### 7. Streaming Tool Call Chunks

`processStreamEvent` emits `tool_call_chunks` for LangChain's concat mechanism:

```typescript
private extractToolCallChunk(event: any): { id?: string; index: number; name?: string; args?: string } | null {
  // content_block_start with tool_use - initial tool call info
  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    return {
      id: event.content_block.id,
      index: event.index ?? 0,
      name: event.content_block.name,
      args: "",
    };
  }
  // content_block_delta with input_json_delta - partial tool args
  if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
    return {
      index: event.index ?? 0,
      args: event.delta.partial_json || "",
    };
  }
  return null;
}
```

Tool call chunks are emitted as `AIMessageChunk` with `tool_call_chunks`:

```typescript
const toolCallChunk = this.extractToolCallChunk(innerEvent);
if (toolCallChunk) {
  const messageChunk = new AIMessageChunk({
    content: "",
    response_metadata: chunkMetadata,
    tool_call_chunks: [toolCallChunk],
  });
  deltaChunks.push(new ChatGenerationChunk({ message: messageChunk, text: "" }));
}
```

---

## Testing

```typescript
const model = new BedrockChatModel({
  modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  apiKey: "...",
  endpoint: "...",
  streamEndpoint: "...",
});

const tools = [
  {
    name: "get_weather",
    description: "Get weather for a location",
    schema: z.object({ location: z.string() }),
  },
];

const boundModel = model.bindTools(tools);
const response = await boundModel.invoke([new HumanMessage("What's the weather in Tokyo?")]);

console.log(response.tool_calls); // Should have tool call
```

---

## Reference

- [Claude Tool Use on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html)
- [Anthropic Tool Use Guide](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [LangChain ChatAnthropic](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-anthropic)
