/**
 * ClaudeStreamParser - Parse streaming JSON responses from Claude CLI
 *
 * Handles line-by-line JSON parsing and conversion to ChatGenerationChunk
 * format for seamless integration with LangChain streaming.
 */

import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";

export interface StreamChunk {
  type: string;
  content?: string;
  error?: string;
  done?: boolean;
}

export class ClaudeStreamParser {
  private buffer: string = "";
  private static readonly MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer size

  /**
   * Parse a chunk of streaming data and return ChatGenerationChunk arrays
   * Handles line-by-line JSON parsing with proper buffering
   */
  parseChunk(data: Buffer | string): ChatGenerationChunk[] {
    const chunks: ChatGenerationChunk[] = [];
    const dataStr = data.toString();

    // Add new data to buffer
    this.buffer += dataStr;

    // Prevent buffer from growing too large (memory management)
    if (this.buffer.length > ClaudeStreamParser.MAX_BUFFER_SIZE) {
      console.warn("ClaudeStreamParser: Buffer size exceeded limit, resetting buffer");
      this.buffer = dataStr; // Keep only new data
    }

    // Split by newlines and process complete lines
    const lines = this.buffer.split("\n");

    // Keep the last potentially incomplete line in buffer
    this.buffer = lines.pop() || "";

    // Process each complete line
    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) {
        continue;
      }

      try {
        const parsed: StreamChunk = JSON.parse(trimmedLine);
        const chunk = this.createChatGenerationChunk(parsed);
        if (chunk) {
          chunks.push(chunk);
        }
      } catch (error) {
        // Handle malformed JSON gracefully - log but continue processing
        console.warn("ClaudeStreamParser: Malformed JSON in stream:", {
          line: trimmedLine,
          error: error instanceof Error ? error.message : String(error),
        });

        // Create an error chunk but continue processing
        const errorChunk = this.createErrorChunk(
          `Malformed JSON: ${trimmedLine.substring(0, 100)}...`
        );
        chunks.push(errorChunk);
      }
    }

    return chunks;
  }

  /**
   * Handle stream errors by creating appropriate error chunks
   */
  handleError(error: Error): ChatGenerationChunk {
    console.error("ClaudeStreamParser: Stream error:", error);
    return this.createErrorChunk(error.message);
  }

  /**
   * Finalize stream processing and handle any remaining buffer content
   */
  finalize(): ChatGenerationChunk | null {
    if (this.buffer.trim()) {
      try {
        const parsed: StreamChunk = JSON.parse(this.buffer.trim());
        const chunk = this.createChatGenerationChunk(parsed);
        this.reset(); // Clear buffer after processing
        return chunk;
      } catch (error) {
        console.warn("ClaudeStreamParser: Malformed JSON in final buffer:", {
          buffer: this.buffer.trim(),
          error: error instanceof Error ? error.message : String(error),
        });

        const errorChunk = this.createErrorChunk(`Final buffer contained malformed JSON`);
        this.reset();
        return errorChunk;
      }
    }

    this.reset();
    return null;
  }

  /**
   * Reset parser state and clear buffer
   */
  reset(): void {
    this.buffer = "";
  }

  /**
   * Create ChatGenerationChunk from parsed StreamChunk data
   * Follows LangChain.js streaming patterns
   */
  private createChatGenerationChunk(parsed: StreamChunk): ChatGenerationChunk | null {
    switch (parsed.type) {
      case "content":
        if (parsed.content !== undefined) {
          const message = new AIMessageChunk(parsed.content);
          return new ChatGenerationChunk({
            message: message,
            text: parsed.content,
            generationInfo: {
              type: "content",
            },
          });
        }
        break;

      case "done":
        // Signal end of stream with empty content but finished flag
        const doneMessage = new AIMessageChunk("");
        return new ChatGenerationChunk({
          message: doneMessage,
          text: "",
          generationInfo: {
            type: "done",
            finished: true,
          },
        });

      case "error":
        if (parsed.error) {
          return this.createErrorChunk(parsed.error);
        }
        break;

      default:
        // Handle unknown chunk types gracefully
        console.warn("ClaudeStreamParser: Unknown chunk type:", parsed.type);
        return null;
    }

    return null;
  }

  /**
   * Create error ChatGenerationChunk with proper formatting
   */
  private createErrorChunk(errorMessage: string): ChatGenerationChunk {
    const message = new AIMessageChunk(`Error: ${errorMessage}`);
    return new ChatGenerationChunk({
      text: `Error: ${errorMessage}`,
      message: message,
      generationInfo: {
        type: "error",
        error: true,
      },
    });
  }
}
