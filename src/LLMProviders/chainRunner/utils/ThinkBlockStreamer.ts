import { ModelAdapter } from "./modelAdapter";

/**
 * ThinkBlockStreamer handles streaming content from various LLM providers
 * that support thinking/reasoning modes (like Claude and Deepseek).
 */
export class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";
  private shouldTruncate = false;

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
          this.fullResponse += item.thinking;
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
      this.fullResponse += chunk.additional_kwargs.reasoning_content;
      return true; // Indicate we handled a thinking chunk
    }
    return false; // No thinking chunk handled
  }

  processChunk(chunk: any) {
    // If we've already decided to truncate, don't process more chunks
    if (this.shouldTruncate) {
      return;
    }

    let handledThinking = false;

    // Handle Claude 3.7 array-based content
    if (Array.isArray(chunk.content)) {
      handledThinking = this.handleClaude37Chunk(chunk.content);
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

  close() {
    // Make sure to close any open think block at the end
    if (this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.updateCurrentAiMessage(this.fullResponse);
    }
    return this.fullResponse;
  }
}
