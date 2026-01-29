/**
 * Custom ChatOllama implementation that preserves thinking content from Ollama's streaming API.
 *
 * LangChain's standard ChatOllama strips the `message.thinking` field when transforming
 * raw Ollama responses into AIMessageChunk objects. This implementation overrides the streaming
 * method to preserve thinking data for use by ThinkBlockStreamer.
 *
 * This implementation works for ALL Ollama models - thinking-capable models get their reasoning
 * preserved in collapsible blocks, while standard models work normally.
 */

import { ChatOllama as BaseChatOllama } from "@langchain/ollama";
import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { logInfo, logError } from "@/logger";

/**
 * Ollama streaming response chunk format
 */
interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: "assistant";
    content: string;
    thinking?: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * ChatOllama implementation that preserves thinking content from streaming responses.
 * Extends LangChain's ChatOllama to directly parse Ollama's native API format.
 */
export class ChatOllama extends BaseChatOllama {
  private customHeaders?: Headers;

  constructor(fields: any) {
    super(fields);
    this.customHeaders = fields.headers;
  }

  /**
   * Override streaming to preserve message.thinking field.
   * Fetches directly from Ollama's /api/chat endpoint and parses the raw response.
   */
  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    // Get base URL (without /v1 suffix)
    const baseUrl = this.baseUrl.replace(/\/v1\/?$/, "");
    const apiUrl = `${baseUrl}/api/chat`;

    // Convert LangChain messages to Ollama format
    const ollamaMessages = messages.map((msg) => ({
      role: msg._getType() === "human" ? "user" : msg._getType() === "ai" ? "assistant" : "system",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    }));

    const requestBody = {
      model: this.model,
      messages: ollamaMessages,
      stream: true,
      options: {
        temperature: this.temperature,
        top_p: this.topP,
        top_k: this.topK,
        num_predict: this.numPredict,
        ...(this.format && { format: this.format }),
      },
    };

    logInfo("ChatOllama: Streaming request to", apiUrl);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...Object.fromEntries(this.customHeaders?.entries() || []),
        },
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}\n${errorText}`
        );
      }

      if (!response.body) {
        throw new Error("No response body from Ollama API");
      }

      // Parse streaming NDJSON response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk: OllamaStreamChunk = JSON.parse(line);

            // Skip chunks without message data
            if (!chunk.message) continue;

            const { content = "", thinking = "" } = chunk.message;

            // Build AIMessageChunk with preserved message structure
            // This allows ThinkBlockStreamer to detect chunk.message !== undefined
            // and access chunk.message.thinking
            const messageChunk = new AIMessageChunk({
              content,
              // Preserve the message structure for ThinkBlockStreamer
              ...(thinking && {
                additional_kwargs: {
                  message: {
                    role: "assistant",
                    content,
                    thinking,
                  },
                },
              }),
            }) as AIMessageChunk & {
              message?: {
                role: "assistant";
                content: string;
                thinking?: string;
              };
            };

            // Attach message property directly for ThinkBlockStreamer routing
            if (thinking) {
              messageChunk.message = {
                role: "assistant",
                content,
                thinking,
              };
            }

            const generationChunk = new ChatGenerationChunk({
              message: messageChunk,
              text: content,
              generationInfo: chunk.done
                ? {
                    done: true,
                    total_duration: chunk.total_duration,
                    eval_count: chunk.eval_count,
                  }
                : undefined,
            });

            yield generationChunk;

            // Notify callback manager
            if (content && runManager) {
              await runManager.handleLLMNewToken(content);
            }
          } catch (parseError: any) {
            logError("ChatOllama: Failed to parse chunk", parseError.message, line);
            continue;
          }
        }
      }
    } catch (error: any) {
      logError("ChatOllama: Stream error", error.message);
      throw error;
    }
  }
}
