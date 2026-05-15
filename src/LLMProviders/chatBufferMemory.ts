import { BaseChatMessageHistory, InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { BaseMessage } from "@langchain/core/messages";

export interface ChatBufferMemoryOptions {
  k?: number;
  memoryKey?: string;
  inputKey?: string;
  returnMessages?: boolean;
  chatHistory?: BaseChatMessageHistory;
}

/**
 * Minimal in-process replacement for `BufferMemory` / `BufferWindowMemory`
 * from `@langchain/classic/memory`. Implements the narrow API surface used
 * by the project (loadMemoryVariables / saveContext / clear / chatHistory)
 * so we can drop the `@langchain/classic` dep.
 */
export class ChatBufferMemory {
  readonly chatHistory: BaseChatMessageHistory;
  private readonly k?: number;
  private readonly memoryKey: string;
  private readonly inputKey?: string;

  constructor(options: ChatBufferMemoryOptions = {}) {
    this.k = options.k;
    this.memoryKey = options.memoryKey ?? "history";
    this.inputKey = options.inputKey;
    this.chatHistory = options.chatHistory ?? new InMemoryChatMessageHistory();
  }

  async loadMemoryVariables(
    _: Record<string, unknown> = {}
  ): Promise<Record<string, BaseMessage[]>> {
    const messages = await this.chatHistory.getMessages();
    const windowed =
      this.k !== undefined && messages.length > this.k ? messages.slice(-this.k) : messages;
    return { [this.memoryKey]: windowed };
  }

  async saveContext(
    input: Record<string, unknown>,
    output: Record<string, unknown>
  ): Promise<void> {
    const inputKey = this.inputKey ?? Object.keys(input)[0];
    const inputValue = input[inputKey];
    const outputValue = output[Object.keys(output)[0]];
    await this.chatHistory.addUserMessage(stringify(inputValue));
    await this.chatHistory.addAIMessage(stringify(outputValue));
  }

  async clear(): Promise<void> {
    await this.chatHistory.clear();
  }
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
