import { logInfo, logWarn } from "@/logger";
import { StructuredTool } from "@langchain/core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { StreamingResult } from "@/types/message";
import { ThinkBlockStreamer } from "./ThinkBlockStreamer";
import { withSuppressedTokenWarnings } from "@/utils";

/**
 * XML-based tool calling for models that don't support native bindTools().
 * This enables agent mode for Ollama and other local models by:
 * 1. Injecting tool definitions into the system prompt as XML
 * 2. Parsing <tool_call> blocks from the model's text response
 * 3. Converting them to the standard tool_calls format
 */

/**
 * Build XML tool descriptions for injection into system prompt.
 */
export function buildXmlToolPrompt(tools: StructuredTool[]): string {
  const toolDescriptions = tools
    .map((tool) => {
      const schema = tool.schema;
      const params = formatZodSchema(schema);
      return `<tool>
<name>${tool.name}</name>
<description>${tool.description}</description>
<parameters>${params}</parameters>
</tool>`;
    })
    .join("\n");

  return `## Available Tools

You have access to the following tools. To use a tool, respond with a <tool_call> XML block.

<tools>
${toolDescriptions}
</tools>

## How to Call Tools

When you need to use a tool, output a <tool_call> block with the tool name and arguments as JSON:

<tool_call>
{"name": "toolName", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

You can make multiple tool calls in a single response. Each call should be in its own <tool_call> block.

IMPORTANT RULES:
- Output tool calls as valid JSON inside <tool_call> tags
- After outputting tool calls, STOP and wait for results
- Do NOT make up or guess tool results
- Tool results will be provided to you in the next message
- If no tools are needed, just respond normally without <tool_call> tags`;
}

/**
 * Format a Zod schema into a human-readable parameter description.
 */
function formatZodSchema(schema: any): string {
  try {
    if (schema && schema._def) {
      const shape = schema._def.shape?.();
      if (shape) {
        const params: string[] = [];
        for (const [key, value] of Object.entries(shape)) {
          const zodField = value as any;
          const desc = zodField?._def?.description || zodField?.description || "";
          const isOptional = zodField?.isOptional?.() || zodField?._def?.typeName === "ZodOptional";
          params.push(`  ${key}${isOptional ? " (optional)" : ""}: ${desc || "string"}`);
        }
        return "\n" + params.join("\n") + "\n";
      }
    }
    return "{}";
  } catch {
    return "{}";
  }
}

/**
 * Parse tool calls from model text output containing <tool_call> XML blocks.
 */
export function parseXmlToolCalls(text: string): { name: string; args: Record<string, unknown> }[] {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.name) {
        toolCalls.push({
          name: parsed.name,
          args: parsed.arguments || parsed.args || {},
        });
      }
    } catch {
      logWarn(`[XMLToolCalling] Failed to parse tool call JSON: ${match[1]?.slice(0, 200)}`);
    }
  }

  return toolCalls;
}

/**
 * Strip <tool_call> blocks from text to get clean content.
 */
export function stripToolCallBlocks(text: string): string {
  return text.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, "").trim();
}

/**
 * Check if a model supports native tool calling (bindTools).
 */
export function supportsNativeToolCalling(model: BaseChatModel): boolean {
  return typeof (model as any).bindTools === "function";
}

/**
 * Stream a model response and parse XML tool calls from the output.
 * This is the XML-based equivalent of streaming with a bound model.
 */
export async function streamWithXmlToolCalling(
  model: BaseChatModel,
  messages: BaseMessage[],
  abortController: AbortController
): Promise<{ content: string; aiMessage: AIMessage; streamingResult: StreamingResult }> {
  const thinkStreamer = new ThinkBlockStreamer(
    () => {}, // No-op - agent mode
    true // excludeThinking
  );

  const stream = await withSuppressedTokenWarnings(() =>
    model.stream(messages, {
      signal: abortController.signal,
    })
  );

  for await (const chunk of stream) {
    if (abortController.signal.aborted) break;
    thinkStreamer.processChunk(chunk);
  }

  const streamingResult = thinkStreamer.close();
  const fullContent = streamingResult.content;

  // Parse XML tool calls from the response text
  const xmlToolCalls = parseXmlToolCalls(fullContent);
  const cleanContent = xmlToolCalls.length > 0 ? stripToolCallBlocks(fullContent) : fullContent;

  logInfo(`[XMLToolCalling] Parsed ${xmlToolCalls.length} tool call(s) from response`);

  // Build AIMessage with parsed tool calls
  const aiMessage = new AIMessage({
    content: cleanContent,
    tool_calls: xmlToolCalls.map((tc, index) => ({
      id: `xml_tc_${Date.now()}_${index}`,
      name: tc.name,
      args: tc.args,
      type: "tool_call" as const,
    })),
  });

  return {
    content: cleanContent,
    aiMessage,
    streamingResult,
  };
}
