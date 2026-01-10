/**
 * Claude Code Chain Runner
 *
 * Implements the ChainRunner interface for Claude Code mode.
 * Uses ClaudeCodeService to execute queries and transforms
 * StreamChunks to the ChatMessage format for the UI.
 */

import { ABORT_REASON } from "@/constants";
import {
  ClaudeCodeService,
  ClaudeCodeServiceOptions,
  getClaudeCodeService,
} from "@/core/claudeCode/ClaudeCodeService";
import {
  StreamChunk,
  TextChunk,
  ThinkingChunk,
  ToolUseChunk,
  ToolResultChunk,
  SessionInitChunk,
  UsageChunk,
  ErrorChunk,
  ContentBlock,
  ImageBlock,
  TextBlock,
} from "@/core/claudeCode/types";
import { LayerToMessagesConverter } from "@/context/LayerToMessagesConverter";
import { logError, logInfo, logWarn } from "@/logger";
import { ChatMessage, ResponseMetadata } from "@/types/message";
import { BaseChainRunner } from "./BaseChainRunner";
import { createToolCallMarker, updateToolCallMarker } from "./utils/toolCallParser";

/**
 * Tool call state for tracking in-progress tool executions
 */
interface ToolCallState {
  id: string;
  toolName: string;
  displayName: string;
  emoji: string;
  input: Record<string, unknown>;
  isExecuting: boolean;
  result?: string;
}

/**
 * Get display name for a Claude Code tool
 *
 * @param toolName - The internal tool name
 * @returns Human-readable display name
 */
function getClaudeCodeToolDisplayName(toolName: string): string {
  const displayNames: Record<string, string> = {
    Read: "Reading file",
    Write: "Writing file",
    Edit: "Editing file",
    Glob: "Finding files",
    Grep: "Searching content",
    Bash: "Running command",
    WebSearch: "Searching web",
    WebFetch: "Fetching URL",
    Task: "Running subtask",
    NotebookEdit: "Editing notebook",
    TodoWrite: "Updating todos",
  };
  return displayNames[toolName] || toolName;
}

/**
 * Get emoji for a Claude Code tool
 *
 * @param toolName - The internal tool name
 * @returns Emoji for the tool
 */
function getClaudeCodeToolEmoji(toolName: string): string {
  const emojis: Record<string, string> = {
    Read: "file",
    Write: "pencil",
    Edit: "scissors",
    Glob: "search",
    Grep: "magnifying-glass",
    Bash: "terminal",
    WebSearch: "globe",
    WebFetch: "link",
    Task: "list-checks",
    NotebookEdit: "notebook",
    TodoWrite: "checkbox",
  };
  return emojis[toolName] || "wrench";
}

/**
 * Convert OpenAI-style image content to Anthropic format
 *
 * OpenAI format: { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }
 * Anthropic format: { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "..." } }
 *
 * @param imageUrl - The data URL from OpenAI format
 * @returns ImageBlock in Anthropic format or null if invalid
 */
function convertImageContent(imageUrl: string): ImageBlock | null {
  try {
    // Parse data URL format: data:image/jpeg;base64,<base64-string>
    const dataUrlMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!dataUrlMatch) {
      return null;
    }

    const [, mediaType, base64Data] = dataUrlMatch;
    if (!mediaType || !base64Data) {
      return null;
    }

    // Validate it's an image media type
    if (!mediaType.startsWith("image/")) {
      return null;
    }

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64Data,
      },
    };
  } catch (error) {
    logError("[ClaudeCodeChainRunner] Error converting image content:", error);
    return null;
  }
}

/**
 * ClaudeCodeChainRunner - Chain runner for Claude Code mode
 *
 * This chain runner uses the Claude Agent SDK (via ClaudeCodeService)
 * to provide agentic capabilities including file read/write, bash commands,
 * and multi-step workflows.
 *
 * StreamChunks are transformed to match the existing UI format:
 * - text chunks: appended to message content
 * - thinking chunks: wrapped in <think> tags
 * - tool_use chunks: converted to XML tool call markers
 * - tool_result chunks: update corresponding tool call markers
 */
export class ClaudeCodeChainRunner extends BaseChainRunner {
  private service: ClaudeCodeService;
  private toolCallStates: Map<string, ToolCallState> = new Map();
  private accumulatedContent = "";
  private accumulatedThinking = "";
  private toolCallMarkers: string[] = [];
  private sessionInfo: {
    sessionId?: string;
    model?: string;
    tools?: string[];
    cwd?: string;
  } = {};

  /**
   * Create a new ClaudeCodeChainRunner
   *
   * @param chainManager - The chain manager instance
   * @param serviceOptions - Optional service configuration
   */
  constructor(chainManager: any, serviceOptions?: ClaudeCodeServiceOptions) {
    super(chainManager);
    this.service = getClaudeCodeService(serviceOptions);
  }

  /**
   * Run a query through Claude Code
   *
   * @param userMessage - The user's message
   * @param abortController - Controller for aborting the request
   * @param updateCurrentAiMessage - Callback to update streaming message
   * @param addMessage - Callback to add final message to chat
   * @param options - Additional options
   * @returns The final AI response text
   */
  async run(
    userMessage: ChatMessage,
    abortController: AbortController,
    updateCurrentAiMessage: (message: string) => void,
    addMessage: (message: ChatMessage) => void,
    options: {
      debug?: boolean;
      ignoreSystemMessage?: boolean;
      updateLoading?: (loading: boolean) => void;
      updateLoadingMessage?: (message: string) => void;
    } = {}
  ): Promise<string> {
    // Reset state for new query
    this.resetState();

    logInfo("[ClaudeCodeChainRunner] Starting query");

    let responseMetadata: ResponseMetadata | undefined;

    try {
      // Initialize service if needed
      if (!this.service.isInitialized()) {
        options.updateLoadingMessage?.("Initializing Claude Code...");
        await this.service.initialize();
      }

      options.updateLoadingMessage?.("Processing with Claude Code...");

      // Build prompt with system context and user context from envelope
      let promptText: string;
      if (userMessage.contextEnvelope) {
        const parts: string[] = [];

        // Extract system prompt (L1) if present
        const systemPrompt = LayerToMessagesConverter.extractSystemMessage(
          userMessage.contextEnvelope
        );
        if (systemPrompt) {
          parts.push(`<system_context>\n${systemPrompt}\n</system_context>`);
        }

        // Extract full user context (L2+L3+L5)
        const userContext = LayerToMessagesConverter.extractFullContext(
          userMessage.contextEnvelope
        );
        if (userContext) {
          parts.push(userContext);
        }

        promptText = parts.join("\n\n");
        logInfo("[ClaudeCodeChainRunner] Using envelope-based context");
      } else {
        // Fallback to processedText (legacy) or original message
        promptText = userMessage.message || userMessage.originalMessage || "";
        logInfo("[ClaudeCodeChainRunner] Using legacy context format");
      }

      // Build content blocks for multimodal support
      const contentBlocks: ContentBlock[] = [];

      // Extract images from userMessage.content (OpenAI format)
      // Images should come before text per Anthropic best practices
      if (userMessage.content && Array.isArray(userMessage.content)) {
        for (const item of userMessage.content) {
          if (
            item &&
            typeof item === "object" &&
            item.type === "image_url" &&
            item.image_url?.url
          ) {
            const imageBlock = convertImageContent(item.image_url.url);
            if (imageBlock) {
              contentBlocks.push(imageBlock);
              logInfo("[ClaudeCodeChainRunner] Added image to content blocks");
            }
          }
        }
      }

      // Add text content
      if (promptText.trim()) {
        contentBlocks.push({ type: "text", text: promptText } as TextBlock);
      }

      // Determine the prompt format: use ContentBlock[] if we have images, otherwise just string
      const prompt: string | ContentBlock[] =
        contentBlocks.length > 1 ||
        (contentBlocks.length === 1 && contentBlocks[0].type === "image")
          ? contentBlocks
          : promptText;

      if (Array.isArray(prompt)) {
        logInfo("[ClaudeCodeChainRunner] Using multimodal content with images");
      }

      // Stream chunks from the service
      for await (const chunk of this.service.query(prompt, abortController.signal)) {
        // Check for abort
        if (abortController.signal.aborted) {
          logInfo("[ClaudeCodeChainRunner] Query aborted", {
            reason: abortController.signal.reason,
          });
          break;
        }

        // Process the chunk
        this.processChunk(chunk, updateCurrentAiMessage, options);

        // Extract usage info if available
        if (chunk.type === "usage") {
          const usageChunk = chunk as UsageChunk;
          responseMetadata = {
            wasTruncated: usageChunk.isError || false,
            tokenUsage: {
              inputTokens: usageChunk.usage.input_tokens,
              outputTokens: usageChunk.usage.output_tokens,
              totalTokens: usageChunk.usage.input_tokens + usageChunk.usage.output_tokens,
            },
          };
        }
      }
    } catch (error: unknown) {
      // Handle abort errors gracefully
      if (error instanceof Error && error.name === "AbortError") {
        logInfo("[ClaudeCodeChainRunner] Query aborted by user");
      } else {
        logError("[ClaudeCodeChainRunner] Query failed:", error);
        await this.handleError(error, (errorMsg) => {
          this.accumulatedContent += `\n\n<errorChunk>${errorMsg}</errorChunk>`;
          this.updateDisplay(updateCurrentAiMessage);
        });
      }
    }

    // Build final response
    const fullAIResponse = this.buildFinalResponse();

    // Handle NEW_CHAT abort specially
    if (abortController.signal.aborted && abortController.signal.reason === ABORT_REASON.NEW_CHAT) {
      updateCurrentAiMessage("");
      return "";
    }

    // Save to memory and add message
    await this.handleResponse(
      fullAIResponse,
      userMessage,
      abortController,
      addMessage,
      updateCurrentAiMessage,
      undefined, // sources
      undefined, // llmFormattedOutput
      responseMetadata
    );

    return fullAIResponse;
  }

  /**
   * Reset internal state for a new query
   */
  private resetState(): void {
    this.toolCallStates.clear();
    this.accumulatedContent = "";
    this.accumulatedThinking = "";
    this.toolCallMarkers = [];
    this.sessionInfo = {};
  }

  /**
   * Process a single StreamChunk
   *
   * @param chunk - The chunk to process
   * @param updateCurrentAiMessage - Callback to update UI
   * @param options - Processing options
   */
  private processChunk(
    chunk: StreamChunk,
    updateCurrentAiMessage: (message: string) => void,
    options: { debug?: boolean; updateLoadingMessage?: (message: string) => void }
  ): void {
    switch (chunk.type) {
      case "session_init":
        this.handleSessionInit(chunk as SessionInitChunk, options);
        break;

      case "text":
        this.handleTextChunk(chunk as TextChunk, updateCurrentAiMessage);
        break;

      case "thinking":
        this.handleThinkingChunk(chunk as ThinkingChunk, updateCurrentAiMessage);
        break;

      case "tool_use":
        this.handleToolUseChunk(chunk as ToolUseChunk, updateCurrentAiMessage, options);
        break;

      case "tool_result":
        this.handleToolResultChunk(chunk as ToolResultChunk, updateCurrentAiMessage);
        break;

      case "usage":
        this.handleUsageChunk(chunk as UsageChunk, options);
        break;

      case "error":
        this.handleErrorChunk(chunk as ErrorChunk, updateCurrentAiMessage);
        break;

      default:
        logWarn("[ClaudeCodeChainRunner] Unknown chunk type:", (chunk as any).type);
    }
  }

  /**
   * Handle session initialization chunk
   */
  private handleSessionInit(chunk: SessionInitChunk, options: { debug?: boolean }): void {
    this.sessionInfo = {
      sessionId: chunk.sessionId,
      model: chunk.model,
      tools: chunk.tools,
      cwd: chunk.cwd,
    };

    if (options.debug) {
      logInfo("[ClaudeCodeChainRunner] Session initialized:", this.sessionInfo);
    }
  }

  /**
   * Handle text content chunk
   */
  private handleTextChunk(
    chunk: TextChunk,
    updateCurrentAiMessage: (message: string) => void
  ): void {
    this.accumulatedContent += chunk.text;
    this.updateDisplay(updateCurrentAiMessage);
  }

  /**
   * Handle thinking/reasoning chunk
   */
  private handleThinkingChunk(
    chunk: ThinkingChunk,
    updateCurrentAiMessage: (message: string) => void
  ): void {
    this.accumulatedThinking += chunk.thinking;
    this.updateDisplay(updateCurrentAiMessage);
  }

  /**
   * Handle tool use chunk (tool call start)
   */
  private handleToolUseChunk(
    chunk: ToolUseChunk,
    updateCurrentAiMessage: (message: string) => void,
    options: { updateLoadingMessage?: (message: string) => void }
  ): void {
    const { toolUseId, toolName, input, isPartial } = chunk;

    // Skip partial chunks with empty ID (streaming updates)
    if (isPartial && !toolUseId) {
      return;
    }

    // Create or update tool call state
    const displayName = getClaudeCodeToolDisplayName(toolName);
    const emoji = getClaudeCodeToolEmoji(toolName);

    const state: ToolCallState = {
      id: toolUseId,
      toolName,
      displayName,
      emoji,
      input,
      isExecuting: true,
    };

    this.toolCallStates.set(toolUseId, state);

    // Update loading message
    options.updateLoadingMessage?.(displayName);

    // Create tool call marker for UI
    const marker = createToolCallMarker(
      toolUseId,
      toolName,
      displayName,
      emoji,
      "", // confirmationMessage
      true, // isExecuting
      "", // content
      "" // result
    );

    // Find existing marker or add new one
    const existingIndex = this.toolCallMarkers.findIndex((m) =>
      m.includes(`TOOL_CALL_START:${toolUseId}:`)
    );
    if (existingIndex !== -1) {
      this.toolCallMarkers[existingIndex] = marker;
    } else {
      this.toolCallMarkers.push(marker);
    }

    this.updateDisplay(updateCurrentAiMessage);
  }

  /**
   * Handle tool result chunk (tool call completion)
   */
  private handleToolResultChunk(
    chunk: ToolResultChunk,
    updateCurrentAiMessage: (message: string) => void
  ): void {
    const { toolUseId, content, isError } = chunk;

    // Update tool call state
    const state = this.toolCallStates.get(toolUseId);
    if (state) {
      state.isExecuting = false;
      state.result = content || (isError ? "Error occurred" : "Completed");
    }

    // Update the tool call marker with result
    const resultText = content || "";
    const markerIndex = this.toolCallMarkers.findIndex((m) =>
      m.includes(`TOOL_CALL_START:${toolUseId}:`)
    );

    if (markerIndex !== -1) {
      this.toolCallMarkers[markerIndex] = updateToolCallMarker(
        this.toolCallMarkers[markerIndex],
        toolUseId,
        resultText
      );
    }

    this.updateDisplay(updateCurrentAiMessage);
  }

  /**
   * Handle usage information chunk
   */
  private handleUsageChunk(chunk: UsageChunk, options: { debug?: boolean }): void {
    if (options.debug) {
      logInfo("[ClaudeCodeChainRunner] Usage:", {
        inputTokens: chunk.usage.input_tokens,
        outputTokens: chunk.usage.output_tokens,
        totalCost: chunk.totalCostUsd,
        duration: chunk.durationMs,
        turns: chunk.numTurns,
      });
    }

    // Handle errors in result
    if (chunk.isError && chunk.errors) {
      logError("[ClaudeCodeChainRunner] Errors in result:", chunk.errors);
    }
  }

  /**
   * Handle error chunk
   */
  private handleErrorChunk(
    chunk: ErrorChunk,
    updateCurrentAiMessage: (message: string) => void
  ): void {
    logError("[ClaudeCodeChainRunner] Error chunk:", chunk.message);

    this.accumulatedContent += `\n\n<errorChunk>${chunk.message}</errorChunk>`;
    this.updateDisplay(updateCurrentAiMessage);
  }

  /**
   * Update the UI display with current accumulated content
   */
  private updateDisplay(updateCurrentAiMessage: (message: string) => void): void {
    const display = this.buildDisplayContent();
    updateCurrentAiMessage(display);
  }

  /**
   * Build the current display content combining text, thinking, and tool calls
   */
  private buildDisplayContent(): string {
    const parts: string[] = [];

    // Add thinking blocks wrapped in <think> tags
    if (this.accumulatedThinking.trim()) {
      parts.push(`<think>\n${this.accumulatedThinking.trim()}\n</think>`);
    }

    // Add text content
    if (this.accumulatedContent.trim()) {
      parts.push(this.accumulatedContent.trim());
    }

    // Add tool call markers
    if (this.toolCallMarkers.length > 0) {
      parts.push(this.toolCallMarkers.join("\n"));
    }

    return parts.join("\n\n");
  }

  /**
   * Build the final response for saving to memory
   */
  private buildFinalResponse(): string {
    return this.buildDisplayContent();
  }

  /**
   * Get the Claude Code service instance
   */
  getService(): ClaudeCodeService {
    return this.service;
  }

  /**
   * Update service options (e.g., when settings change)
   */
  updateServiceOptions(options: ClaudeCodeServiceOptions): void {
    this.service.updateOptions(options);
  }
}
