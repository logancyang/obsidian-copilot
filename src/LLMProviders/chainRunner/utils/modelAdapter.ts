import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Model-specific adaptations for autonomous agent
 * Handles quirks and requirements of different LLM providers
 */

export interface ModelAdapter {
  /**
   * Enhance system prompt with model-specific instructions
   */
  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string;

  /**
   * Enhance user message if needed for specific models
   */
  enhanceUserMessage(message: string, requiresTools: boolean): string;

  /**
   * Parse tool calls from model response (future: handle different formats)
   */
  parseToolCalls?(response: string): any[];

  /**
   * Check if model needs special handling
   */
  needsSpecialHandling(): boolean;
}

/**
 * Base adapter with default behavior (no modifications)
 */
class BaseModelAdapter implements ModelAdapter {
  constructor(protected modelName: string) {}

  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string {
    return `${basePrompt}

# Autonomous Agent Mode

You are now in autonomous agent mode. You can use tools to gather information and complete tasks step by step.

When you need to use a tool, format it EXACTLY like this:
<use_tool>
<name>tool_name_here</name>
<args>
{
  "param1": "value1",
  "param2": "value2"
}
</args>
</use_tool>

## Important Tool Usage Examples:

For localSearch (searching notes in the vault):
<use_tool>
<name>localSearch</name>
<args>
{
  "query": "piano learning",
  "salientTerms": ["piano", "learning", "practice", "music"]
}
</args>
</use_tool>

For webSearch:
<use_tool>
<name>webSearch</name>
<args>
{
  "query": "piano learning techniques",
  "chatHistory": []
}
</args>
</use_tool>

For getFileTree:
<use_tool>
<name>getFileTree</name>
<args>
{}
</args>
</use_tool>

Available tools:
${toolDescriptions}

CRITICAL: For localSearch, you MUST always provide both "query" (string) and "salientTerms" (array of strings). Extract key terms from the query for salientTerms.

You can use multiple tools in sequence. After each tool execution, you'll receive the results and can decide whether to use more tools or provide your final response.

Always explain your reasoning before using tools. Be conversational and clear about what you're doing.
When you've gathered enough information, provide your final response without any tool calls.

IMPORTANT: Do not include any code blocks (\`\`\`) or tool_code blocks in your responses. Only use the <use_tool> format for tool calls.`;
  }

  enhanceUserMessage(message: string, requiresTools: boolean): string {
    return message;
  }

  needsSpecialHandling(): boolean {
    return false;
  }
}

/**
 * GPT-specific adapter with aggressive prompting
 */
class GPTModelAdapter extends BaseModelAdapter {
  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string {
    const baseSystemPrompt = super.enhanceSystemPrompt(basePrompt, toolDescriptions);

    // Insert GPT-specific instructions after the base prompt
    const gptSpecificSection = `

CRITICAL FOR GPT MODELS: You MUST ALWAYS include XML tool calls in your response. Do not just describe what you plan to do - you MUST include the actual XML tool call blocks.

EXAMPLE OF CORRECT RESPONSE:
"I'll search your vault for piano learning notes.

<use_tool>
<name>localSearch</name>
<args>
{
  "query": "piano learning",
  "salientTerms": ["piano", "learning", "practice", "technique"]
}
</args>
</use_tool>"

EXAMPLE OF INCORRECT RESPONSE (DO NOT DO THIS):
"I'll search your vault for piano learning notes."
(Missing the XML tool call)

FINAL REMINDER FOR GPT MODELS: If the user asks you to search, find, or look up anything, you MUST include the appropriate <use_tool> XML block in your very next response. Do not wait for another turn.`;

    return baseSystemPrompt + gptSpecificSection;
  }

  enhanceUserMessage(message: string, requiresTools: boolean): string {
    if (requiresTools) {
      const requiresSearch =
        message.toLowerCase().includes("find") ||
        message.toLowerCase().includes("search") ||
        message.toLowerCase().includes("my notes");

      if (requiresSearch) {
        return `${message}\n\nREMINDER: Use the <use_tool> XML format to call the localSearch tool.`;
      }
    }
    return message;
  }

  needsSpecialHandling(): boolean {
    return true;
  }
}

/**
 * Claude adapter with special handling for thinking models
 */
class ClaudeModelAdapter extends BaseModelAdapter {
  private isThinkingModel(): boolean {
    return (
      this.modelName.includes("claude-3-7-sonnet") ||
      this.modelName.includes("claude-sonnet-4") ||
      this.modelName.includes("claude-3.7-sonnet") ||
      this.modelName.includes("claude-4-sonnet")
    );
  }

  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string {
    const baseSystemPrompt = super.enhanceSystemPrompt(basePrompt, toolDescriptions);

    // Add specific instructions for thinking models
    if (this.isThinkingModel()) {
      const thinkingModelSection = `

IMPORTANT FOR CLAUDE THINKING MODELS:
- You are a thinking model with internal reasoning capability
- Your thinking process will be automatically wrapped in <think> tags - do not manually add thinking tags
- Place ALL tool calls AFTER your thinking is complete, in the main response body
- Tool calls must be in the main response body, NOT inside thinking sections
- Format tool calls exactly as shown in the examples above
- Do not provide final answers before using tools - use tools first, then provide your response based on the results
- If you need to use tools, include them immediately after your thinking, before any final response

CORRECT FLOW FOR THINKING MODELS:
1. Think through the problem (this happens automatically)
2. Use tools to gather information (place tool calls in main response)
3. Wait for tool results
4. Provide final response based on gathered information

INCORRECT: Providing a final answer before using tools
CORRECT: Using tools first, then providing answer based on results`;

      return baseSystemPrompt + thinkingModelSection;
    }

    return baseSystemPrompt;
  }

  needsSpecialHandling(): boolean {
    return this.isThinkingModel();
  }
}

/**
 * Gemini adapter
 */
class GeminiModelAdapter extends BaseModelAdapter {
  // Gemini also works well with base implementation
  // Ready for future customization if needed
}

/**
 * Factory to create appropriate adapter based on model
 */
export class ModelAdapterFactory {
  static createAdapter(model: BaseChatModel): ModelAdapter {
    const modelName = ((model as any).modelName || (model as any).model || "").toLowerCase();

    // GPT models need special handling
    if (modelName.includes("gpt")) {
      return new GPTModelAdapter(modelName);
    }

    // Claude models
    if (modelName.includes("claude")) {
      return new ClaudeModelAdapter(modelName);
    }

    // Gemini models
    if (modelName.includes("gemini")) {
      return new GeminiModelAdapter(modelName);
    }

    // Copilot Plus models
    if (modelName.includes("copilot-plus")) {
      return new BaseModelAdapter(modelName);
    }

    // Default adapter for unknown models
    return new BaseModelAdapter(modelName);
  }
}

/**
 * Helper to detect if user message likely requires tools
 */
export function messageRequiresTools(message: string): boolean {
  const toolIndicators = [
    "find",
    "search",
    "look for",
    "look up",
    "my notes",
    "in my vault",
    "from my vault",
    "check the web",
    "search online",
    "from the internet",
    "current time",
    "what time",
    "timer",
    "youtube",
    "video",
    "transcript",
  ];

  const lowerMessage = message.toLowerCase();
  return toolIndicators.some((indicator) => lowerMessage.includes(indicator));
}
