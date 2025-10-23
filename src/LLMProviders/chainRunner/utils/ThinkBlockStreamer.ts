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
    private modelAdapter?: ModelAdapter,
    private excludeThinking: boolean = false
  ) {}

  private handleClaude37Chunk(content: any[]) {
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
   * OpenRouter exposes reasoning via:
   * - delta.reasoning (streaming)
   * - reasoning_details array (final response)
   */
  private handleOpenRouterChunk(chunk: any) {
    let handledThinking = false;

    // Handle streaming reasoning from delta
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
      handledThinking = true;
    }

    // Handle reasoning_details from final response or accumulated chunks
    // IMPORTANT: Only treat as thinking if the array has actual content
    if (chunk.additional_kwargs?.reasoning_details) {
      const details = chunk.additional_kwargs.reasoning_details;
      if (Array.isArray(details) && details.length > 0) {
        // Skip thinking content if excludeThinking is enabled
        if (this.excludeThinking) {
          return true;
        }

        for (const detail of details) {
          if (detail.encrypted) {
            // Show placeholder for encrypted reasoning
            if (!this.hasOpenThinkBlock) {
              this.fullResponse += "\n<think>";
              this.hasOpenThinkBlock = true;
            }
            this.fullResponse += "[Encrypted reasoning]";
            handledThinking = true;
          } else if (detail.text) {
            if (!this.hasOpenThinkBlock) {
              this.fullResponse += "\n<think>";
              this.hasOpenThinkBlock = true;
            }
            this.fullResponse += detail.text;
            handledThinking = true;
          } else if (detail.summary) {
            if (!this.hasOpenThinkBlock) {
              this.fullResponse += "\n<think>";
              this.hasOpenThinkBlock = true;
            }
            this.fullResponse += detail.summary;
            handledThinking = true;
          }
        }
      }
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

    return handledThinking;
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

    // Determine if this chunk will handle thinking content
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
      this.handleClaude37Chunk(chunk.content);
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
