import { LangChainParams } from "@/aiParams";
import { BaseChatMemory, BufferWindowMemory } from "langchain/memory";

export default class MemoryManager {
  private static instance: MemoryManager;
  private memory: BaseChatMemory;
  private debug: boolean;

  private constructor(
    private langChainParams: LangChainParams,
    debug = false
  ) {
    this.debug = debug;
    this.initMemory();
  }

  static getInstance(langChainParams: LangChainParams, debug = false): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager(langChainParams, debug);
    }
    return MemoryManager.instance;
  }

  private initMemory(): void {
    this.memory = new BufferWindowMemory({
      k: this.langChainParams.chatContextTurns * 2,
      memoryKey: "history",
      inputKey: "input",
      returnMessages: true,
    });
    if (this.debug)
      console.log("Memory initialized with context turns:", this.langChainParams.chatContextTurns);
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

  async saveContext(input: any, output: any): Promise<void> {
    if (this.debug) console.log("Saving to memory - Input:", input, "Output:", output);
    await this.memory.saveContext(input, output);
  }
}
