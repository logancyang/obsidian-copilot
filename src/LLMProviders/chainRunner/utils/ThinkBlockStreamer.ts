import { StreamingResult, TokenUsage } from "@/types/message";
import { AIMessage } from "@langchain/core/messages";
import { detectTruncation, extractTokenUsage } from "./finishReasonDetector";
import { formatErrorChunk } from "@/utils/toolResultUtils";
import {
  NativeToolCall,
  ToolCallChunk,
  buildToolCallsFromChunks,
  createAIMessageWithToolCalls,
} from "./nativeToolCalling";
import { logWarn } from "@/logger";

/**
 * ThinkBlockStreamer handles streaming content from various LLM providers
 * that support thinking/reasoning modes (like Claude and Deepseek).
 * Also accumulates native tool calls from tool_call_chunks during streaming.
 * Also detects truncation due to token limits across all providers.
 */
export class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";
  private errorResponse = "";
  private wasTruncated = false;
  private tokenUsage: TokenUsage | null = null;

  // Native tool call accumulation
  private toolCallChunks: Map<number, ToolCallChunk> = new Map();
  private accumulatedToolCalls: NativeToolCall[] = [];

  constructor(
    private updateCurrentAiMessage: (message: string) => void,
    private excludeThinking: boolean = false
  ) {}

  private handleClaudeChunk(content: any[]) {
    let textContent = "";
    let hasThinkingContent = false;
    for (const item of content) {
      switch (item.type) {
        case "text":
          textContent += item.text;
          break;
        case "thinking":
          hasThinkingContent = true;
          // Skip thinking content if excludeThinking is enabled
          if (this.excludeThinking) {
            break;
          }
          if (!this.hasOpenThinkBlock) {
            this.fullResponse += "\n<think>";
            this.hasOpenThinkBlock = true;
          }
          // Guard against undefined thinking content
          if (item.thinking !== undefined) {
            this.fullResponse += item.thinking;
          }
          this.updateCurrentAiMessage(this.fullResponse);
          break;
      }
    }
    // Close think block before adding text content
    if (textContent && this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }
    if (textContent) {
      this.fullResponse += textContent;
    }
    return hasThinkingContent;
  }

  private handleDeepseekChunk(chunk: any) {
    // Handle standard string content
    if (typeof chunk.content === "string") {
      this.fullResponse += chunk.content;
    }

    // Handle deepseek reasoning/thinking content
    if (chunk.additional_kwargs?.reasoning_content) {
      // Skip thinking content if excludeThinking is enabled
      if (this.excludeThinking) {
        return true; // Indicate we handled (but skipped) a thinking chunk
      }
      if (!this.hasOpenThinkBlock) {
        this.fullResponse += "\n<think>";
        this.hasOpenThinkBlock = true;
      }
      // Guard against undefined reasoning content
      if (chunk.additional_kwargs.reasoning_content !== undefined) {
        this.fullResponse += chunk.additional_kwargs.reasoning_content;
      }
      return true; // Indicate we handled a thinking chunk
    }
    return false; // No thinking chunk handled
  }

  /**
   * Handle OpenRouter reasoning/thinking content
   *
   * OpenRouter exposes reasoning via two channels:
   * - delta.reasoning (streaming, token-by-token)
   * - reasoning_details (cumulative transcript array)
   *
   * STRATEGY: We use ONLY delta.reasoning for thinking content.
   *
   * Why delta-only?
   * - Provides minimal latency (streaming as tokens arrive)
   * - No duplication issues (single source of truth)
   * - No complex cumulative bookkeeping needed
   *
   * Trade-offs:
   * - Models that only populate reasoning_details (without delta.reasoning) won't show thinking
   * - This is acceptable for now as most models use delta.reasoning for streaming
   */
  private handleOpenRouterChunk(chunk: any) {
    // Only process delta.reasoning (streaming), ignore reasoning_details entirely
    if (chunk.additional_kwargs?.delta?.reasoning) {
      // Skip thinking content if excludeThinking is enabled
      if (this.excludeThinking) {
        return true;
      }
      if (!this.hasOpenThinkBlock) {
        this.fullResponse += "\n<think>";
        this.hasOpenThinkBlock = true;
      }
      this.fullResponse += chunk.additional_kwargs.delta.reasoning;
      return true; // Handled thinking
    }

    // Close think block before adding regular content
    if (typeof chunk.content === "string" && chunk.content && this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    // Handle standard string content (this is the actual response, not thinking)
    if (typeof chunk.content === "string" && chunk.content) {
      this.fullResponse += chunk.content;
    }

    return false; // No thinking handled
  }

  /**
   * Accumulate native tool call chunks during streaming.
   * LangChain providers send tool_call_chunks with incremental data.
   */
  private handleToolCallChunks(chunk: any) {
    // Check for tool_call_chunks in the chunk (LangChain streaming format)
    const toolCallChunks = chunk.tool_call_chunks;
    if (!toolCallChunks || !Array.isArray(toolCallChunks)) {
      return;
    }

    for (const tc of toolCallChunks) {
      const idx = tc.index ?? 0;
      const existing = this.toolCallChunks.get(idx) || { name: "", args: "" };

      // Accumulate data from chunk
      if (tc.id) existing.id = tc.id;
      if (tc.name) existing.name += tc.name;
      if (tc.args) existing.args += tc.args;

      this.toolCallChunks.set(idx, existing);
    }
  }

  processChunk(chunk: any) {
    // Detect truncation using multi-provider detector
    const truncationResult = detectTruncation(chunk);
    if (truncationResult.wasTruncated) {
      this.wasTruncated = true;
    }

    // Extract token usage if available
    const usage = extractTokenUsage(chunk);
    if (usage) {
      this.tokenUsage = usage;
    }

    // Handle native tool call chunks (LangChain streaming)
    this.handleToolCallChunks(chunk);

    // Determine if this chunk will handle thinking content
    // Note: For OpenRouter, we process only delta.reasoning, but we still need to recognize
    // reasoning_details as a thinking chunk to prevent premature think block closure
    const isThinkingChunk =
      Array.isArray(chunk.content) ||
      chunk.additional_kwargs?.delta?.reasoning ||
      (chunk.additional_kwargs?.reasoning_details &&
        Array.isArray(chunk.additional_kwargs.reasoning_details) &&
        chunk.additional_kwargs.reasoning_details.length > 0) ||
      chunk.additional_kwargs?.reasoning_content; // Deepseek format

    // Close think block BEFORE processing non-thinking content
    if (this.hasOpenThinkBlock && !isThinkingChunk) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    // Now process the chunk
    // Route based on the actual chunk format
    if (Array.isArray(chunk.content)) {
      // Claude format with content array
      this.handleClaudeChunk(chunk.content);
    } else if (chunk.additional_kwargs?.reasoning_content) {
      // Deepseek format with reasoning_content
      this.handleDeepseekChunk(chunk);
    } else if (isThinkingChunk) {
      // OpenRouter format with delta.reasoning or reasoning_details
      this.handleOpenRouterChunk(chunk);
    } else {
      // Default case: regular content or other formats
      this.handleDeepseekChunk(chunk);
    }

    this.updateCurrentAiMessage(this.fullResponse);
  }

  processErrorChunk(errorMessage: string) {
    this.errorResponse = formatErrorChunk(errorMessage);
  }

  /**
   * Get the accumulated tool calls from streaming chunks.
   * Call this after streaming is complete to get all tool calls.
   */
  getToolCalls(): NativeToolCall[] {
    // If we have pre-accumulated tool calls (from non-streaming), return those
    if (this.accumulatedToolCalls.length > 0) {
      return this.accumulatedToolCalls;
    }
    // Otherwise build from streaming chunks
    return buildToolCallsFromChunks(this.toolCallChunks);
  }

  /**
   * Check if there are any tool calls accumulated
   */
  hasToolCalls(): boolean {
    return this.toolCallChunks.size > 0 || this.accumulatedToolCalls.length > 0;
  }

  /**
   * Set tool calls directly (for non-streaming responses)
   */
  setToolCalls(toolCalls: NativeToolCall[]) {
    this.accumulatedToolCalls = toolCalls;
  }

  /**
   * Build an AIMessage with the accumulated content and tool calls.
   * Use this to add the complete response to conversation history.
   */
  buildAIMessage(): AIMessage {
    const toolCalls = this.getToolCalls();
    return createAIMessageWithToolCalls(this.fullResponse, toolCalls);
  }

  close(): StreamingResult {
    // Make sure to close any open think block at the end
    if (this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
    }

    // Post-process: fix missing opening <think> tag
    // Some models (e.g., nvidia/nemotron) output thinking content with only </think> closing tag
    if (this.fullResponse.includes("</think>") && !this.fullResponse.includes("<think>")) {
      logWarn(
        "Detected </think> closing tag without opening <think> tag. " +
          "This may indicate a misconfigured chat template in LM Studio. Adding opening tag."
      );
      this.fullResponse = "<think>" + this.fullResponse;
    }

    if (this.errorResponse) {
      this.fullResponse += this.errorResponse;
    }

    this.updateCurrentAiMessage(this.fullResponse);

    return {
      content: this.fullResponse,
      wasTruncated: this.wasTruncated,
      tokenUsage: this.tokenUsage,
    };
  }
}
