/**
 * ThinkBlockStreamer handles streaming content from various LLM providers
 * that support thinking/reasoning modes (like Claude and Deepseek).
 */
export class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";

  constructor(private updateCurrentAiMessage: (message: string) => void) {}

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

    this.updateCurrentAiMessage(this.fullResponse);
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
