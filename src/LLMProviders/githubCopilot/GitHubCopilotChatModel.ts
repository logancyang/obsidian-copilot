import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage, type MessageContent } from "@langchain/core/messages";
import { type ChatResult, ChatGeneration, ChatGenerationChunk } from "@langchain/core/outputs";
import { type CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { GitHubCopilotProvider } from "./GitHubCopilotProvider";
import { extractTextFromChunk } from "@/utils";

// Approximate characters per token for English text
const CHARS_PER_TOKEN = 4;

export interface GitHubCopilotChatModelParams extends BaseChatModelParams {
  modelName: string;
  streaming?: boolean;
}

/**
 * LangChain BaseChatModel implementation for GitHub Copilot
 */
export class GitHubCopilotChatModel extends BaseChatModel {
  lc_serializable = false;
  lc_namespace = ["langchain", "chat_models", "github_copilot"];

  private provider: GitHubCopilotProvider;
  modelName: string;
  streaming: boolean;

  constructor(fields: GitHubCopilotChatModelParams) {
    super(fields);
    this.provider = GitHubCopilotProvider.getInstance();
    this.modelName = fields.modelName;
    this.streaming = fields.streaming ?? true;
  }

  _llmType(): string {
    return "github-copilot";
  }

  /**
   * Convert LangChain message type to OpenAI role.
   * Note: Copilot API may not support tool/function roles, so we normalize them to user.
   */
  private convertMessageType(messageType: string): string {
    switch (messageType) {
      case "human":
        return "user";
      case "ai":
        return "assistant";
      case "system":
        return "system";
      case "tool":
      case "function":
        // Copilot API may not support these roles, normalize to user
        return "user";
      case "generic":
      default:
        return "user";
    }
  }

  /**
   * Convert LangChain messages to Copilot API format.
   */
  private toCopilotMessages(messages: BaseMessage[]): Array<{ role: string; content: string }> {
    return messages.map((m) => ({
      role: this.convertMessageType(m._getType()),
      content: extractTextFromChunk(m.content),
    }));
  }

  /**
   * Generate chat completion
   */
  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const chatMessages = this.toCopilotMessages(messages);

    // Call Copilot API
    const response = await this.provider.sendChatMessage(chatMessages, this.modelName);
    const choice = response.choices?.[0];
    const content = choice?.message?.content || "";
    const finishReason = choice?.finish_reason;

    // Map token usage to camelCase format expected by the project
    const tokenUsage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    // Build response_metadata for truncation detection and token usage extraction
    const responseMetadata = {
      finish_reason: finishReason,
      tokenUsage,
      model: response.model,
    };

    const generation: ChatGeneration = {
      text: content,
      message: new AIMessage({
        content,
        response_metadata: responseMetadata,
      }),
      generationInfo: { finish_reason: finishReason },
    };

    return {
      generations: [generation],
      llmOutput: {
        tokenUsage,
      },
    };
  }

  /**
   * Stream chat completion chunks.
   * If streaming is disabled, yields a single chunk from _generate.
   * If streaming fails, the error is propagated (no silent fallback).
   */
  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    // If streaming is disabled, use _generate and yield as single chunk
    if (!this.streaming) {
      const result = await this._generate(messages, options, runManager);
      const generation = result.generations[0];
      if (!generation) return;

      const messageChunk = new AIMessageChunk({
        content: generation.text,
        response_metadata: generation.message.response_metadata,
      });

      const generationChunk = new ChatGenerationChunk({
        message: messageChunk,
        text: generation.text,
        generationInfo: generation.generationInfo,
      });

      if (runManager && generation.text) {
        await runManager.handleLLMNewToken(generation.text);
      }

      yield generationChunk;
      return;
    }

    const chatMessages = this.toCopilotMessages(messages);
    let didYieldChunk = false;

    // Stream directly, no fallback - errors are propagated to caller
    for await (const chunk of this.provider.sendChatMessageStream(
      chatMessages,
      this.modelName,
      options?.signal
    )) {
      const choice = chunk.choices?.[0];
      const content = choice?.delta?.content || "";

      // Don't skip chunks with usage or finish_reason even if content is empty
      const hasMetadata = choice?.finish_reason || chunk.usage || choice?.delta?.role;
      if (!content && !hasMetadata) {
        continue;
      }

      // Build response_metadata for the chunk
      const responseMetadata: Record<string, unknown> = {};
      if (choice?.finish_reason) {
        responseMetadata.finish_reason = choice.finish_reason;
      }
      if (choice?.delta?.role) {
        responseMetadata.role = choice.delta.role;
      }
      if (chunk.usage) {
        responseMetadata.tokenUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
      if (chunk.model) {
        responseMetadata.model = chunk.model;
      }

      const messageChunk = new AIMessageChunk({
        content,
        response_metadata: Object.keys(responseMetadata).length > 0 ? responseMetadata : undefined,
      });

      const generationChunk = new ChatGenerationChunk({
        message: messageChunk,
        text: content,
        generationInfo: choice?.finish_reason ? { finish_reason: choice.finish_reason } : undefined,
      });

      // Notify run manager of new token
      if (runManager && content) {
        await runManager.handleLLMNewToken(content);
      }

      didYieldChunk = true;
      yield generationChunk;
    }

    // Detect silent failures where streaming completed but produced no chunks at all.
    // Avoid treating metadata-only streams as failures.
    if (!didYieldChunk) {
      throw new Error("GitHub Copilot streaming produced no chunks");
    }
  }

  /**
   * Simple token estimation based on character count
   */
  async getNumTokens(content: MessageContent): Promise<number> {
    const text = extractTextFromChunk(content);
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
