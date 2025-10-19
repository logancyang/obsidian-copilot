import { StreamingResult, TokenUsage } from "@/types/message";
import { ModelAdapter } from "./modelAdapter";
import { detectTruncation, extractTokenUsage } from "./finishReasonDetector";

/**
 * ThinkBlockStreamer handles streaming content from various LLM providers
 * that support thinking/reasoning modes (like Claude and Deepseek).
 * Also detects truncation due to token limits across all providers.
 */
export class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";
  private shouldTruncate = false;
  private wasTruncated = false;
  private tokenUsage: TokenUsage | null = null;

  constructor(
    private updateCurrentAiMessage: (message: string) => void,
    private modelAdapter?: ModelAdapter
  ) {}

  private handleClaude37Chunk(content: any[]) {
    let textContent = "";
    for (const item of content) {
      switch (item.type) {
        case "text":
          textContent += item.text;
          break;
        case "thinking":
          if (!this.hasOpenThinkBlock) {
            this.fullResponse += "\n<think>";
            this.hasOpenThinkBlock = true;
          }
          // Guard against undefined thinking content
          if (item.thinking !== undefined) {
            this.fullResponse += item.thinking;
          }
          this.updateCurrentAiMessage(this.fullResponse);
          return true; // Indicate we handled a thinking chunk
      }
    }
    if (textContent) {
      this.fullResponse += textContent;
    }
    return false; // No thinking chunk handled
  }

  private handleDeepseekChunk(chunk: any) {
    // Handle standard string content
    if (typeof chunk.content === "string") {
      this.fullResponse += chunk.content;
    }

    // Handle deepseek reasoning/thinking content
    if (chunk.additional_kwargs?.reasoning_content) {
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
   * Handles GPT-5 reasoning chunks from OpenAI's Responses API
   * GPT-5 returns reasoning in additional_kwargs.reasoning_details as an array
   */
  private handleGPT5Chunk(chunk: any) {
    // Handle standard string content
    if (typeof chunk.content === "string") {
      this.fullResponse += chunk.content;
    }

    let handledReasoning = false;

    // Handle GPT-5 reasoning details (structured format)
    // Format: additional_kwargs.reasoning_details = [{ type: "reasoning.summary", summary: "text", format: "openai-responses-v1", index: 0 }]
    if (
      chunk.additional_kwargs?.reasoning_details &&
      Array.isArray(chunk.additional_kwargs.reasoning_details)
    ) {
      const reasoningItems = chunk.additional_kwargs.reasoning_details.filter(
        (item: any) => item.type === "reasoning.summary" && item.summary
      );

      if (reasoningItems.length > 0) {
        if (!this.hasOpenThinkBlock) {
          this.fullResponse += "\n<think>";
          this.hasOpenThinkBlock = true;
        }

        // Concatenate all reasoning summaries
        for (const item of reasoningItems) {
          if (item.summary !== undefined) {
            this.fullResponse += item.summary;
          }
        }
        handledReasoning = true;
      }
    }

    // Also check for reasoning content in additional_kwargs.reasoning (alternative format)
    // Some providers may send reasoning as a string directly
    if (
      chunk.additional_kwargs?.reasoning &&
      typeof chunk.additional_kwargs.reasoning === "string"
    ) {
      if (!this.hasOpenThinkBlock) {
        this.fullResponse += "\n<think>";
        this.hasOpenThinkBlock = true;
      }
      this.fullResponse += chunk.additional_kwargs.reasoning;
      handledReasoning = true;
    }

    return handledReasoning;
  }

  processChunk(chunk: any) {
    // If we've already decided to truncate, don't process more chunks
    if (this.shouldTruncate) {
      return;
    }

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

    let handledThinking = false;

    // Handle Claude 3.7 array-based content
    if (Array.isArray(chunk.content)) {
      handledThinking = this.handleClaude37Chunk(chunk.content);
    } else if (chunk.additional_kwargs?.reasoning_details) {
      // Handle GPT-5 reasoning format
      handledThinking = this.handleGPT5Chunk(chunk);
    } else {
      // Handle deepseek format
      handledThinking = this.handleDeepseekChunk(chunk);
    }

    // Close think block if we have one open and didn't handle thinking content
    if (this.hasOpenThinkBlock && !handledThinking) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    // Check if we should truncate streaming based on model adapter
    if (this.modelAdapter?.shouldTruncateStreaming?.(this.fullResponse)) {
      this.shouldTruncate = true;
      // Find the last complete tool call to truncate cleanly
      this.fullResponse = this.truncateToLastCompleteToolCall(this.fullResponse);
    }

    this.updateCurrentAiMessage(this.fullResponse);
  }

  private truncateToLastCompleteToolCall(response: string): string {
    // Find the last complete </use_tool> tag
    const lastCompleteToolEnd = response.lastIndexOf("</use_tool>");

    if (lastCompleteToolEnd === -1) {
      // No complete tool calls found, return original response
      return response;
    }

    // Truncate to after the last complete tool call
    const truncated = response.substring(0, lastCompleteToolEnd + "</use_tool>".length);

    // Use model adapter to sanitize if available
    if (this.modelAdapter?.sanitizeResponse) {
      return this.modelAdapter.sanitizeResponse(truncated, 1);
    }

    return truncated;
  }

  close(): StreamingResult {
    // Make sure to close any open think block at the end
    if (this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.updateCurrentAiMessage(this.fullResponse);
    }

    return {
      content: this.fullResponse,
      wasTruncated: this.wasTruncated,
      tokenUsage: this.tokenUsage,
    };
  }
}
