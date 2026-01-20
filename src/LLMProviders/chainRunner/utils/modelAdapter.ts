import { logInfo } from "@/logger";
import { ToolMetadata } from "@/tools/ToolRegistry";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Represents a labeled segment of the system prompt used for tool prompting.
 */
export interface PromptSection {
  id: string;
  label: string;
  source: string;
  content: string;
}

/**
 * Join prompt sections into a single prompt while preserving blank line separation.
 *
 * @param sections - Prompt sections to concatenate in order.
 * @returns The combined prompt content suitable for LLM input.
 */
export function joinPromptSections(sections: PromptSection[]): string {
  return sections
    .map((section) => section.content)
    .filter((content) => content && content.trim().length > 0)
    .join("\n\n");
}

/**
 * Model-specific adaptations for autonomous agent
 * Handles quirks and requirements of different LLM providers
 */

export interface ModelAdapter {
  /**
   * Enhance system prompt with model-specific instructions
   * @param basePrompt - The base system prompt to enhance
   * @param toolDescriptions - Available tool descriptions to include
   * @param availableToolNames - List of enabled tool names (for backward compatibility)
   * @param toolMetadata - Tool metadata including custom instructions
   * @returns The enhanced system prompt
   */
  enhanceSystemPrompt(
    basePrompt: string,
    toolDescriptions: string,
    availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): string;

  /**
   * Build ordered system prompt sections tagged with their source information.
   *
   * @param basePrompt - The base system prompt to enhance.
   * @param toolDescriptions - The tool descriptions included in the prompt.
   * @param availableToolNames - Names of tools enabled for the run.
   * @param toolMetadata - Metadata with custom instructions for each tool.
   * @returns Array of prompt sections in the order they should appear.
   */
  buildSystemPromptSections(
    basePrompt: string,
    toolDescriptions: string,
    availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): PromptSection[];

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
}

/**
 * Base adapter with default behavior (no modifications)
 */
class BaseModelAdapter implements ModelAdapter {
  constructor(protected modelName: string) {}

  private buildToolSpecificInstructions(toolMetadata: ToolMetadata[]): string {
    const instructions: string[] = [];

    // Collect all custom instructions from tool metadata
    for (const meta of toolMetadata) {
      if (meta.customPromptInstructions) {
        instructions.push(meta.customPromptInstructions);
      }
    }

    const copilotCommandInstructions = this.buildCopilotCommandInstructions(toolMetadata);
    if (copilotCommandInstructions) {
      instructions.push(copilotCommandInstructions);
    }

    return instructions.length > 0 ? instructions.join("\n\n") : "";
  }

  /**
   * Build instructional text that maps Copilot command aliases to tool names.
   *
   * @param toolMetadata - Metadata for all tools available to the agent.
   * @returns Instructional string or null if there are no Copilot aliases.
   */
  private buildCopilotCommandInstructions(toolMetadata: ToolMetadata[]): string | null {
    const aliasLines: string[] = [];

    for (const meta of toolMetadata) {
      if (!meta.copilotCommands || meta.copilotCommands.length === 0) {
        continue;
      }

      for (const command of meta.copilotCommands) {
        aliasLines.push(`- ${command}: call the tool named ${meta.id}`);
      }
    }

    if (aliasLines.length === 0) {
      return null;
    }

    return [
      "When the user explicitly includes a Copilot command alias (e.g., @vault) in their message, treat it as a direct request to call the mapped tool before proceeding.",
      "Honor these aliases exactly (case-insensitive):",
      ...aliasLines,
      "If the referenced tool is unavailable, explain that the command cannot be fulfilled instead of ignoring it.",
    ].join("\n");
  }

  enhanceSystemPrompt(
    basePrompt: string,
    toolDescriptions: string,
    availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): string {
    const sections = this.buildSystemPromptSections(
      basePrompt,
      toolDescriptions,
      availableToolNames,
      toolMetadata
    );
    return joinPromptSections(sections);
  }

  buildSystemPromptSections(
    basePrompt: string,
    toolDescriptions: string,
    _availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): PromptSection[] {
    const metadata = toolMetadata || [];
    const toolSpecificInstructions = this.buildToolSpecificInstructions(metadata).trim();
    const normalizedBasePrompt = basePrompt.trimEnd();
    const sections: PromptSection[] = [
      {
        id: "base-system-prompt",
        label: "System prompt with memory",
        source: "src/system-prompts/systemPromptBuilder.ts#getSystemPromptWithMemory",
        content: normalizedBasePrompt,
      },
      {
        id: "autonomous-agent-intro",
        label: "Autonomous agent introduction",
        source:
          "src/LLMProviders/chainRunner/utils/modelAdapter.ts#BaseModelAdapter.buildSystemPromptSections",
        content: `# Autonomous Agent Mode

You are now in autonomous agent mode. You can use tools to gather information and complete tasks step by step.

Tools are provided via native function calling - use them when needed to complete tasks.
`,
      },
    ];

    const trimmedToolDescriptions = toolDescriptions.trim();

    if (trimmedToolDescriptions.length > 0) {
      sections.push({
        id: "tool-descriptions",
        label: "Tool descriptions (native tool calling via bindTools)",
        source: "Native tool calling - schemas provided via bindTools()",
        content: `Available tools:
${trimmedToolDescriptions}`,
      });
    }

    sections.push({
      id: "tool-usage-guidelines",
      label: "Tool usage guidelines",
      source:
        "src/LLMProviders/chainRunner/utils/modelAdapter.ts#BaseModelAdapter.buildSystemPromptSections",
      content: `# Tool Usage Guidelines

## Time-based Queries
When users ask about temporal periods (e.g., "what did I do last month", "show me notes from last week"), you MUST:
1. First call getTimeRangeMs to convert the time expression to a proper time range
2. Then use localSearch with the timeRange parameter from step 1
3. For salientTerms, ONLY use words that exist in the user's original query (excluding time expressions)

Example for "what did I do last month":
1. Call getTimeRangeMs with timeExpression: "last month"
2. Use localSearch with query matching the user's question
3. salientTerms: [] - empty because "what", "I", "do" are not meaningful search terms

Example for "meetings about project X last week":
1. Call getTimeRangeMs with timeExpression: "last week"
2. Use localSearch with query "meetings about project X"
3. salientTerms: ["meetings", "project", "X"] - these words exist in the original query

## File-related Queries

### Handle ambiguity in folder/note paths
When user mentions a folder name (e.g., "meetings folder") or a note name (e.g., "meeting note template") without providing an exact path,
you MUST first call getFileTree to find the folder or notes best matching the user's query.
If multiple results or no result, you should ask the user to provide a more specific path.
`,
    });

    if (toolSpecificInstructions.length > 0) {
      sections.push({
        id: "tool-specific-instructions",
        label: "Tool-specific instructions",
        source:
          "src/LLMProviders/chainRunner/utils/modelAdapter.ts#BaseModelAdapter.buildToolSpecificInstructions",
        content: toolSpecificInstructions,
      });
    }

    sections.push({
      id: "general-guidelines",
      label: "General guidelines",
      source:
        "src/LLMProviders/chainRunner/utils/modelAdapter.ts#BaseModelAdapter.buildSystemPromptSections",
      content: `## General Guidelines
- Think hard about whether a query could potentially be answered from personal knowledge or notes, if yes, call a vault search (localSearch) first
- NEVER mention tool names like "localSearch", "webSearch", etc. in your responses. Use natural language like "searching your vault", "searching the web", etc.

You can use multiple tools in sequence. After each tool execution, you'll receive the results and can decide whether to use more tools or provide your final response.

Always explain your reasoning before using tools. Be conversational and clear about what you're doing.
When you've gathered enough information, provide your final response without any tool calls.

## Citation Integrity (CRITICAL)
- ONLY cite sources from tools you ACTUALLY called and received results from
- NEVER fabricate or hallucinate search results, web searches, or any tool outputs
- If you did not call a tool, do not claim you did or cite results from it
- Each citation must correspond to a real document or result returned by a tool in this conversation`,
    });

    return sections;
  }

  enhanceUserMessage(message: string, _requiresTools: boolean): string {
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
  /**
   * Check if this is a GPT-5 model
   * @returns True if the model is in the GPT-5 family
   */
  protected isGPT5Model(): boolean {
    return this.modelName.includes("gpt-5") || this.modelName.includes("gpt5");
  }
  buildSystemPromptSections(
    basePrompt: string,
    toolDescriptions: string,
    availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): PromptSection[] {
    const sections = super.buildSystemPromptSections(
      basePrompt,
      toolDescriptions,
      availableToolNames,
      toolMetadata
    );

    const tools = availableToolNames || [];
    const hasComposerTools = tools.includes("writeToFile") || tools.includes("replaceInFile");

    const gptSectionParts: string[] = [];

    if (this.isGPT5Model()) {
      gptSectionParts.push(`GPT-5 SPECIFIC RULES:
- Use maximum 2 tool calls initially, then provide an answer
- Call each tool ONCE per unique query
- For optional parameters: OMIT them entirely if not needed (don't pass empty strings/null)
- For localSearch: OMIT timeRange if not doing time-based search`);
    } else {
      gptSectionParts.push(
        "CRITICAL FOR GPT MODELS: You MUST use tools when the user's request requires them. Do not just describe what you plan to do - actually call the tools."
      );
    }

    if (hasComposerTools) {
      gptSectionParts.push(`🚨 FILE EDITING WITH COMPOSER TOOLS 🚨

When user asks you to edit or modify a file, you MUST:
1. Determine if it's a small edit (use replaceInFile) or major rewrite (use writeToFile)
2. Call the tool immediately - do not just describe what you plan to do

For replaceInFile, the diff parameter must use SEARCH/REPLACE format:
------- SEARCH
content to find
=======
replacement content
+++++++ REPLACE

❌ WRONG: "I'll help you add item 4 to the list. Let me update that for you." [No tool call = FAILURE]
✅ CORRECT: Actually call replaceInFile or writeToFile with proper parameters`);
    }

    gptSectionParts.push(
      "FINAL REMINDER FOR GPT MODELS: If the user asks you to search, find, edit, or modify anything, you MUST call the appropriate tool immediately. Do not wait for another turn."
    );

    const gptSpecificContent = gptSectionParts.join("\n\n");

    sections.push({
      id: "gpt-specific-guidelines",
      label: "GPT-specific guidance",
      source:
        "src/LLMProviders/chainRunner/utils/modelAdapter.ts#GPTModelAdapter.buildSystemPromptSections",
      content: gptSpecificContent,
    });

    return sections;
  }

  enhanceUserMessage(message: string, requiresTools: boolean): string {
    if (requiresTools) {
      return this.getBaseEnhancement(message, requiresTools);
    }
    return message;
  }

  private getBaseEnhancement(message: string, requiresTools: boolean): string {
    if (!requiresTools) return message;

    const lowerMessage = message.toLowerCase();
    const requiresSearch =
      lowerMessage.includes("find") ||
      lowerMessage.includes("search") ||
      lowerMessage.includes("my notes");

    const requiresFileEdit =
      lowerMessage.includes("edit") ||
      lowerMessage.includes("modify") ||
      lowerMessage.includes("update") ||
      lowerMessage.includes("change") ||
      lowerMessage.includes("fix") ||
      lowerMessage.includes("add") ||
      lowerMessage.includes("typo");

    if (requiresSearch) {
      return `${message}\n\nREMINDER: Call the localSearch tool now.`;
    }

    if (requiresFileEdit) {
      return `${message}\n\n🚨 GPT REMINDER: Use replaceInFile for small edits (with SEARCH/REPLACE blocks in diff parameter).`;
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

  buildSystemPromptSections(
    basePrompt: string,
    toolDescriptions: string,
    availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): PromptSection[] {
    const sections = super.buildSystemPromptSections(
      basePrompt,
      toolDescriptions,
      availableToolNames,
      toolMetadata
    );

    if (!this.isThinkingModel()) {
      return sections;
    }

    const thinkingSectionParts: string[] = [
      `IMPORTANT FOR CLAUDE THINKING MODELS:
- You are a thinking model with internal reasoning capability
- Your thinking process will be automatically wrapped in <think> tags - do not manually add thinking tags
- Call tools AFTER your thinking is complete
- Do not provide final answers before using tools - use tools first, then provide your response based on the results

CORRECT FLOW FOR THINKING MODELS:
1. Think through the problem (this happens automatically)
2. Use tools to gather information
3. Wait for tool results
4. Provide final response based on gathered information

INCORRECT: Providing a final answer before using tools
CORRECT: Using tools first, then providing answer based on results`,
    ];

    if (this.isClaudeSonnet4()) {
      thinkingSectionParts.push(`🚨 CRITICAL INSTRUCTIONS FOR CLAUDE SONNET 4 - AUTONOMOUS AGENT MODE 🚨

⚠️  WARNING: You have a specific tendency to write complete responses immediately after tool calls. This BREAKS the autonomous agent pattern!

🔄 CORRECT AUTONOMOUS AGENT ITERATION PATTERN:
1. User asks question
2. Brief sentence about what you'll do (1 sentence max)
3. Use tools to gather information
4. ✋ STOP after tool calls - Do not write anything else
5. Wait for tool results (system provides them)
6. Evaluate results and either: Use more tools OR provide final answer

✅ IDEAL RESPONSE FLOW:
- Brief action statement (1 sentence)
- Tool calls
- STOP (wait for results)
- Brief transition statement (1 sentence)
- More tool calls OR final answer

🎯 CORRECT PATTERN:
I'll search your vault for piano practice information.
[Call localSearch tool]
[RESPONSE ENDS HERE - NO MORE TEXT]

❌ WRONG PATTERN (DO NOT DO THIS):
[Call tool]
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

REMEMBER: One brief sentence before tools is perfect. Nothing after tool calls.`);
    }

    sections.push({
      id: "claude-thinking-guidelines",
      label: "Claude thinking model guidance",
      source:
        "src/LLMProviders/chainRunner/utils/modelAdapter.ts#ClaudeModelAdapter.buildSystemPromptSections",
      content: thinkingSectionParts.join("\n\n"),
    });

    return sections;
  }

  needsSpecialHandling(): boolean {
    return this.isThinkingModel();
  }
}

/**
 * Gemini adapter with aggressive tool calling prompts
 */
class GeminiModelAdapter extends BaseModelAdapter {
  buildSystemPromptSections(
    basePrompt: string,
    toolDescriptions: string,
    availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): PromptSection[] {
    const sections = super.buildSystemPromptSections(
      basePrompt,
      toolDescriptions,
      availableToolNames,
      toolMetadata
    );

    // Gemini needs very explicit instructions about tool usage
    const tools = availableToolNames || [];
    const hasLocalSearch = tools.includes("localSearch");

    const geminiSectionParts: string[] = [
      `🚨 CRITICAL INSTRUCTIONS FOR GEMINI - AUTONOMOUS AGENT MODE 🚨

You MUST use tools to complete tasks. DO NOT ask the user questions about how to proceed.
${
  hasLocalSearch
    ? `
When the user mentions "my notes" or "my vault", use the localSearch tool.

❌ WRONG:
"Let's start by searching your notes. What kind of information should I look for?"

✅ CORRECT: Call localSearch immediately with the user's topic as the query`
    : ""
}`.trim(),
    ];

    geminiSectionParts.push(`GEMINI SPECIFIC RULES:
1. When user mentions "my notes" about X → use localSearch with query "X"
2. DO NOT ask clarifying questions about search terms
3. DO NOT wait for permission to use tools
4. Use tools based on the user's request

🚨 CRITICAL: SEQUENTIAL vs PARALLEL TOOL CALLS 🚨

When one tool's OUTPUT is needed as INPUT to another tool, you MUST make them in SEPARATE responses:
1. Call the FIRST tool
2. STOP and wait for the result
3. In the NEXT response, use the result from step 1 in the SECOND tool call

❌ WRONG (DO NOT DO THIS):
User: "Recap my last week"
- Call getTimeRangeMs AND localSearch together with made-up timeRange values
- This is WRONG because you're hallucinating the timeRange values!

✅ CORRECT (DO THIS):
User: "Recap my last week"
- FIRST: Call getTimeRangeMs with timeExpression "last week"
- WAIT for result
- SECOND: Call localSearch using the actual timeRange from the result

RULE: NEVER make up or guess parameter values. If you need a tool's output, call that tool FIRST, then WAIT for the result.

Remember: The user has already told you what to do. Execute it NOW with the available tools.`);

    sections.push({
      id: "gemini-specific-guidelines",
      label: "Gemini-specific guidance",
      source:
        "src/LLMProviders/chainRunner/utils/modelAdapter.ts#GeminiModelAdapter.buildSystemPromptSections",
      content: geminiSectionParts.join("\n\n"),
    });

    return sections;
  }

  enhanceUserMessage(message: string, requiresTools: boolean): string {
    if (requiresTools) {
      // Add explicit reminder for Gemini
      return `${message}\n\nREMINDER: Use the tools immediately. Do not ask questions. For "my notes", use localSearch.`;
    }
    return message;
  }

  needsSpecialHandling(): boolean {
    return true;
  }
}

/**
 * Copilot Plus adapter for Flash models with anti-hallucination focus
 */
class CopilotPlusModelAdapter extends BaseModelAdapter {
  buildSystemPromptSections(
    basePrompt: string,
    toolDescriptions: string,
    availableToolNames?: string[],
    toolMetadata?: ToolMetadata[]
  ): PromptSection[] {
    const sections = super.buildSystemPromptSections(
      basePrompt,
      toolDescriptions,
      availableToolNames,
      toolMetadata
    );

    sections.push({
      id: "copilot-plus-guidelines",
      label: "Copilot Plus model guidance",
      source:
        "src/LLMProviders/chainRunner/utils/modelAdapter.ts#CopilotPlusModelAdapter.buildSystemPromptSections",
      content: `🚨 CRITICAL: NO HALLUCINATED TOOL CALLS OR SOURCES 🚨

You are a Copilot Plus model. You MUST follow these rules strictly:

## Tool Call Integrity
- You can ONLY reference results from tools you have ACTUALLY called in this conversation
- NEVER claim to have performed a web search unless you called the webSearch tool AND received results
- NEVER claim to have searched notes unless you called localSearch AND received results
- If you want to search the web, you MUST call the webSearch tool first - do not make up results

## Citation Rules
- Every citation [1], [2], etc. MUST correspond to a real source returned by a tool
- Do NOT invent sources like "General web search results for X" unless webSearch was actually called
- If you only called localSearch, your citations can ONLY reference notes from that search
- Count your actual tool calls - if you only made 1 tool call, you cannot have citations from multiple different tools

## Before Writing Citations
Ask yourself: "Did I actually call this tool and receive this result?"
- If YES: You may cite it
- If NO: Do NOT cite it or claim you did

REMEMBER: It is better to say "I only searched your notes, not the web" than to fabricate web search results.`,
    });

    return sections;
  }

  needsSpecialHandling(): boolean {
    return true;
  }
}

/**
 * Factory to create appropriate adapter based on model
 */
export class ModelAdapterFactory {
  static createAdapter(model: BaseChatModel): ModelAdapter {
    const modelName = ((model as any).modelName || (model as any).model || "").toLowerCase();

    logInfo(`Creating model adapter for: ${modelName}`);

    // GPT models need special handling
    if (modelName.includes("gpt")) {
      const adapter = new GPTModelAdapter(modelName);
      // Log if it's a GPT-5 model for debugging
      if ((adapter as any).isGPT5Model()) {
        logInfo("Using GPTModelAdapter with GPT-5 specific enhancements");
      } else {
        logInfo("Using GPTModelAdapter");
      }
      return adapter;
    }

    // Claude models
    if (modelName.includes("claude")) {
      logInfo("Using ClaudeModelAdapter");
      return new ClaudeModelAdapter(modelName);
    }

    // Gemini models (check for both "gemini" and "google" prefixes)
    if (modelName.includes("gemini") || modelName.includes("google/gemini")) {
      logInfo("Using GeminiModelAdapter");
      return new GeminiModelAdapter(modelName);
    }

    // Copilot Plus models (Flash-based, needs anti-hallucination guidance)
    if (modelName.includes("copilot-plus")) {
      logInfo("Using CopilotPlusModelAdapter");
      return new CopilotPlusModelAdapter(modelName);
    }

    // Default adapter for unknown models
    logInfo("Using BaseModelAdapter (default)");
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
