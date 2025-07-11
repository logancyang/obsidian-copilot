import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Model-specific adaptations for autonomous agent
 * Handles quirks and requirements of different LLM providers
 */

export interface ModelAdapter {
  /**
   * Enhance system prompt with model-specific instructions
   * @param basePrompt - The base system prompt to enhance
   * @param toolDescriptions - Available tool descriptions to include
   * @returns The enhanced system prompt
   */
  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string;

  /**
   * Enhance user message if needed for specific models
   * @param message - The user's message to enhance
   * @param requiresTools - Whether the message likely requires tool usage
   * @returns The enhanced user message
   */
  enhanceUserMessage(message: string, requiresTools: boolean): string;

  /**
   * Parse tool calls from model response (future: handle different formats)
   * @param response - The model's response text containing tool calls
   * @returns Array of parsed tool calls
   */
  parseToolCalls?(response: string): any[];

  /**
   * Check if model needs special handling
   * @returns True if the model requires special handling beyond base behavior
   */
  needsSpecialHandling(): boolean;

  /**
   * Sanitize response for autonomous agent mode (e.g., remove premature content)
   * @param response - The model's response text to sanitize
   * @param iteration - The current iteration number in the autonomous agent loop
   * @returns The sanitized response text
   */
  sanitizeResponse?(response: string, iteration: number): string;

  /**
   * Check if streaming should be truncated early for this model
   * @param partialResponse - The partial response text received during streaming
   * @returns True if streaming should be truncated at this point
   */
  shouldTruncateStreaming?(partialResponse: string): boolean;

  /**
   * Detect premature responses for this model
   * @param response - The model's response text to analyze
   * @returns Object indicating if premature content was detected and its type
   */
  detectPrematureResponse?(response: string): {
    hasPremature: boolean;
    type: "before" | "after" | null;
  };
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
  /**
   * Check if this is a Claude thinking model (3.7 Sonnet or Claude 4)
   * @returns True if the model supports thinking/reasoning modes
   */
  private isThinkingModel(): boolean {
    return (
      this.modelName.includes("claude-3-7-sonnet") ||
      this.modelName.includes("claude-sonnet-4") ||
      this.modelName.includes("claude-3.7-sonnet") ||
      this.modelName.includes("claude-4-sonnet")
    );
  }

  /**
   * Check if this is specifically Claude Sonnet 4 (has hallucination issues)
   * @returns True if the model is Claude Sonnet 4 variants
   */
  private isClaudeSonnet4(): boolean {
    return (
      this.modelName.includes("claude-sonnet-4") ||
      this.modelName.includes("claude-4-sonnet") ||
      this.modelName.includes("claude-sonnet-4-20250514")
    );
  }

  enhanceSystemPrompt(basePrompt: string, toolDescriptions: string): string {
    const baseSystemPrompt = super.enhanceSystemPrompt(basePrompt, toolDescriptions);

    // Add specific instructions for thinking models
    if (this.isThinkingModel()) {
      let thinkingModelSection = `

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

      // Add even stronger instructions specifically for Claude Sonnet 4
      if (this.isClaudeSonnet4()) {
        thinkingModelSection += `

🚨 CRITICAL INSTRUCTIONS FOR CLAUDE SONNET 4 - AUTONOMOUS AGENT MODE 🚨

⚠️  WARNING: You have a specific tendency to write complete responses immediately after tool calls. This BREAKS the autonomous agent pattern!

🔄 CORRECT AUTONOMOUS AGENT ITERATION PATTERN:
1. User asks question
2. Brief sentence about what you'll do (1 sentence max)
3. Use tools to gather information: <use_tool>...</use_tool>
4. ✋ STOP after tool calls - Do not write anything else
5. Wait for tool results (system provides them)
6. Evaluate results and either: Use more tools OR provide final answer

✅ IDEAL RESPONSE FLOW:
- Brief action statement (1 sentence)
- Tool calls
- STOP (wait for results)
- Brief transition statement (1 sentence) 
- More tool calls OR final answer

🎯 CORRECT FIRST RESPONSE PATTERN (when tools needed):
I'll search your vault and the web for piano practice information.

<use_tool>
<name>localSearch</name>
<args>{"query": "piano learning", "salientTerms": ["piano", "learning"]}</args>
</use_tool>

<use_tool>
<name>webSearch</name>
<args>{"query": "piano techniques", "chatHistory": []}</args>
</use_tool>

[RESPONSE ENDS HERE - NO MORE TEXT]

🎯 CORRECT FOLLOW-UP RESPONSE PATTERN:
Let me gather more specific information about practice routines.

<use_tool>
<name>localSearch</name>
<args>{"query": "practice schedule", "salientTerms": ["practice", "routine", "schedule"]}</args>
</use_tool>

[RESPONSE ENDS HERE - NO MORE TEXT]

❌ WRONG PATTERN (DO NOT DO THIS):
<use_tool>...</use_tool>

Based on the search results, here's a complete practice plan...
[This is FORBIDDEN - you haven't received results yet!]

🔑 KEY UNDERSTANDING FOR CLAUDE 4:
- Brief 1-sentence explanations BEFORE tool calls are good
- Each response is ONE STEP in a multi-step process
- After tool calls, STOP and wait for the system to provide results
- Your thinking is automatically handled in <think> blocks

⚡ AUTONOMOUS AGENT RULES FOR CLAUDE 4:
1. If you need tools: Brief sentence + tool calls, then STOP
2. If you receive tool results: Evaluate if you need more tools
3. If you need more tools: Brief sentence + more tool calls, then STOP
4. If you have enough info: THEN provide your final response

REMEMBER: One brief sentence before tools is perfect. Nothing after tool calls.`;
      }

      return baseSystemPrompt + thinkingModelSection;
    }

    return baseSystemPrompt;
  }

  needsSpecialHandling(): boolean {
    return this.isThinkingModel();
  }

  /**
   * Detect premature responses in Claude models, especially Claude 4
   * Checks for content before tool calls (allowed in small amounts) and after tool calls (not allowed)
   * @param response - The model's response text to analyze
   * @returns Object indicating if premature content was detected and its type
   */
  detectPrematureResponse(response: string): {
    hasPremature: boolean;
    type: "before" | "after" | null;
  } {
    const firstToolCallIndex = response.indexOf("<use_tool>");

    if (firstToolCallIndex === -1) {
      // No tool calls at all, so it's either a final response or a problem
      return { hasPremature: false, type: null };
    }

    // Check content before tool calls - allow brief sentences (1-2 sentences max)
    const contentBeforeTools = response.substring(0, firstToolCallIndex).trim();
    const contentBeforeWithoutThinking = contentBeforeTools
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();

    // Allow brief action statements (up to 2 sentences, 200 characters)
    const sentences = contentBeforeWithoutThinking
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);
    const BRIEF_STATEMENT_THRESHOLD = 200; // characters

    if (sentences.length > 2 || contentBeforeWithoutThinking.length > BRIEF_STATEMENT_THRESHOLD) {
      return { hasPremature: true, type: "before" };
    }

    // Check content after last tool call (main Claude 4 issue)
    const lastToolCallEndIndex = response.lastIndexOf("</use_tool>");
    if (lastToolCallEndIndex !== -1) {
      const contentAfterTools = response
        .substring(lastToolCallEndIndex + "</use_tool>".length)
        .trim();

      // Remove think blocks to analyze only non-thinking content
      const contentAfterWithoutThinking = contentAfterTools
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .trim();

      // Simple threshold: any substantial non-thinking content after tools is premature
      const SUBSTANTIAL_CONTENT_THRESHOLD = 100; // characters

      if (contentAfterWithoutThinking.length > SUBSTANTIAL_CONTENT_THRESHOLD) {
        return { hasPremature: true, type: "after" };
      }
    }

    return { hasPremature: false, type: null };
  }

  /**
   * Sanitize Claude 4 responses by removing premature content after tool calls
   * Preserves all think blocks while removing substantial non-thinking content
   * @param response - The model's response text to sanitize
   * @param iteration - The current iteration number (only sanitizes first iteration)
   * @returns The sanitized response text
   */
  sanitizeResponse(response: string, iteration: number): string {
    if (!this.isClaudeSonnet4() || iteration !== 1) {
      return response;
    }

    const prematureResult = this.detectPrematureResponse(response);
    if (!prematureResult.hasPremature) {
      return response;
    }

    if (prematureResult.type === "after") {
      // Simple approach: preserve ALL think blocks, remove substantial non-thinking content
      const lastToolCallEndIndex = response.lastIndexOf("</use_tool>");
      if (lastToolCallEndIndex !== -1) {
        const baseResponse = response.substring(0, lastToolCallEndIndex + "</use_tool>".length);
        const contentAfterTools = response.substring(lastToolCallEndIndex + "</use_tool>".length);

        // Extract and preserve ALL think blocks
        const thinkBlockRegex = /<think>[\s\S]*?<\/think>/g;
        const thinkBlocks = contentAfterTools.match(thinkBlockRegex) || [];

        // Return base response + all think blocks (remove everything else)
        return baseResponse + (thinkBlocks.length > 0 ? "\n" + thinkBlocks.join("\n") : "");
      }
    }

    return response;
  }

  /**
   * Check if Claude 4 streaming should be truncated to prevent hallucinated content
   * @param partialResponse - The partial response text received during streaming
   * @returns True if streaming should be truncated at this point
   */
  shouldTruncateStreaming(partialResponse: string): boolean {
    if (!this.isClaudeSonnet4()) {
      return false;
    }

    // Check if we have tool calls and substantial non-thinking content after them
    const lastToolCallEndIndex = partialResponse.lastIndexOf("</use_tool>");
    if (lastToolCallEndIndex === -1) {
      return false;
    }

    const contentAfterTools = partialResponse
      .substring(lastToolCallEndIndex + "</use_tool>".length)
      .trim();

    // Remove think blocks to analyze only non-thinking content
    const contentAfterWithoutThinking = contentAfterTools
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();

    // Simple threshold: if there's substantial non-thinking content, truncate
    const STREAMING_TRUNCATE_THRESHOLD = 50;
    return contentAfterWithoutThinking.length > STREAMING_TRUNCATE_THRESHOLD;
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
 * @param message - The user's message to analyze
 * @returns True if the message likely requires tool usage
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
