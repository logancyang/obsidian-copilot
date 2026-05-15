import { compactAssistantOutput } from "@/context/ChatHistoryCompactor";
import { logInfo } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";
import { ChatBufferMemory } from "./chatBufferMemory";

export default class MemoryManager {
  private static instance: MemoryManager;
  private memory: ChatBufferMemory;
  private debug: boolean;

  private constructor() {
    this.initMemory();
    subscribeToSettingsChange(() => {
      // keep pre history
      const history = this.memory?.chatHistory;
      this.initMemory(history);
    });
  }

  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  private initMemory(chatHistory?: BaseChatMessageHistory): void {
    const chatContextTurns = getSettings().contextTurns;
    this.memory = new ChatBufferMemory({
      k: chatContextTurns * 2,
      memoryKey: "history",
      inputKey: "input",
      returnMessages: true,
      chatHistory: chatHistory,
    });
    if (this.debug) {
      logInfo("Memory initialized with context turns:", chatContextTurns);
    }
  }

  getMemory(): ChatBufferMemory {
    return this.memory;
  }

  async clearChatMemory(): Promise<void> {
    if (this.debug) logInfo("Clearing chat memory");
    await this.memory.clear();
  }

  async loadMemoryVariables(): Promise<Record<string, unknown>> {
    const variables = await this.memory.loadMemoryVariables({});
    if (this.debug) logInfo("Loaded memory variables:", variables);
    return variables;
  }

  /**
   * Save a conversation turn to memory.
   * The output (assistant response) is compacted to reduce memory bloat from
   * accumulated tool results (localSearch, readNote, etc.).
   */
  async saveContext(
    input: Record<string, unknown>,
    output: Record<string, unknown> | string
  ): Promise<void> {
    // Compact the output to prevent memory bloat from tool results
    const compactedOutput =
      typeof output === "string"
        ? compactAssistantOutput(output)
        : {
            ...output,
            output: compactAssistantOutput((output as { output: string | unknown[] }).output),
          };

    if (this.debug) {
      logInfo("Saving to memory - Input:", input, "Output (compacted):", compactedOutput);
    }
    await this.memory.saveContext(
      input,
      compactedOutput as Parameters<typeof this.memory.saveContext>[1]
    );
  }
}
