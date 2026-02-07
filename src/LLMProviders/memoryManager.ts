import { compactAssistantOutput } from "@/context/ChatHistoryCompactor";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { BaseChatMemory, BufferWindowMemory } from "@langchain/classic/memory";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";

export default class MemoryManager {
  private static instance: MemoryManager;
  private memory: BaseChatMemory;
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
    this.memory = new BufferWindowMemory({
      k: chatContextTurns * 2,
      memoryKey: "history",
      inputKey: "input",
      returnMessages: true,
      chatHistory: chatHistory,
    });
    if (this.debug) {
      console.log("Memory initialized with context turns:", chatContextTurns);
    }
  }

  getMemory(): BaseChatMemory {
    return this.memory;
  }

  async clearChatMemory(): Promise<void> {
    if (this.debug) console.log("Clearing chat memory");
    await this.memory.clear();
  }

  async loadMemoryVariables(): Promise<any> {
    const variables = await this.memory.loadMemoryVariables({});
    if (this.debug) console.log("Loaded memory variables:", variables);
    return variables;
  }

  /**
   * Save a conversation turn to memory.
   * The output (assistant response) is compacted to reduce memory bloat from
   * accumulated tool results (localSearch, readNote, etc.).
   */
  async saveContext(input: any, output: any): Promise<void> {
    // Compact the output to prevent memory bloat from tool results
    const compactedOutput =
      typeof output === "string"
        ? compactAssistantOutput(output)
        : { ...output, output: compactAssistantOutput(output.output) };

    if (this.debug) {
      console.log("Saving to memory - Input:", input, "Output (compacted):", compactedOutput);
    }
    await this.memory.saveContext(input, compactedOutput);
  }
}
