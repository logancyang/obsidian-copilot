import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage, type MessageContent } from "@langchain/core/messages";
import { type ChatResult, ChatGeneration } from "@langchain/core/outputs";
import { type CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { GitHubCopilotProvider } from "./GitHubCopilotProvider";
import { extractTextFromChunk } from "@/utils";

// Approximate characters per token for English text
const CHARS_PER_TOKEN = 4;

export interface GitHubCopilotChatModelParams extends BaseChatModelParams {
  modelName: string;
}

/**
 * LangChain BaseChatModel implementation for GitHub Copilot
 */
export class GitHubCopilotChatModel extends BaseChatModel {
  lc_serializable = false;
  lc_namespace = ["langchain", "chat_models", "github_copilot"];

  private provider: GitHubCopilotProvider;
  modelName: string;

  constructor(fields: GitHubCopilotChatModelParams) {
    super(fields);
    this.provider = GitHubCopilotProvider.getInstance();
    this.modelName = fields.modelName;
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
   * Generate chat completion
   */
  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    // Convert LangChain messages to OpenAI format
    const chatMessages = messages.map((m) => ({
      role: this.convertMessageType(m._getType()),
      content: extractTextFromChunk(m.content),
    }));

    // Call Copilot API
    const response = await this.provider.sendChatMessage(chatMessages, this.modelName);
    const content = response.choices?.[0]?.message?.content || "";

    const generation: ChatGeneration = {
      text: content,
      message: new AIMessage(content),
    };

    return {
      generations: [generation],
      llmOutput: {
        tokenUsage: response.usage,
      },
    };
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
