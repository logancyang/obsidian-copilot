import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage, type MessageContent } from "@langchain/core/messages";
import { type ChatResult, ChatGeneration } from "@langchain/core/outputs";
import { type CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { GitHubCopilotProvider } from "./githubCopilotProvider";
import { extractTextFromChunk } from "@/utils";

export interface CopilotChatModelParams extends BaseChatModelParams {
  provider: GitHubCopilotProvider;
  modelName: string;
}

export class CopilotChatModel extends BaseChatModel {
  lc_serializable = false;
  lc_namespace = ["langchain", "chat_models", "copilot"];
  private provider: GitHubCopilotProvider;
  modelName: string;

  constructor(fields: CopilotChatModelParams) {
    super(fields);
    this.provider = fields.provider;
    this.modelName = fields.modelName;
  }

  _llmType(): string {
    return "copilot-chat-model";
  }

  private _convertMessageType(messageType: string): string {
    switch (messageType) {
      case "human":
        return "user";
      case "ai":
        return "assistant";
      case "system":
        return "system";
      case "tool":
        return "tool";
      case "function":
        return "function";
      case "generic":
      default:
        return "user";
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const chatMessages = messages.map((m) => ({
      role: this._convertMessageType(m._getType()),
      content: extractTextFromChunk(m.content),
    }));

    const response = await this.provider.sendChatMessage(chatMessages, this.modelName);
    const content = response.choices?.[0]?.message?.content || "";

    const generation: ChatGeneration = {
      text: content,
      message: new AIMessage(content),
    };

    return {
      generations: [generation],
      llmOutput: {}, // add more details here if needed
    };
  }

  /**
   * A simple approximation: ~4 chars per token for English text
   * This matches the fallback behavior in ChatModelManager.countTokens
   */
  async getNumTokens(content: MessageContent): Promise<number> {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }
}
