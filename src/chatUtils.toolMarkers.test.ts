import { AI_SENDER, USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { updateChatMemory } from "./chatUtils";

jest.mock("@/logger");

class MockMemory {
  public saved: Array<{ input: string; output: string }> = [];
  async saveContext(input: { input: string }, output: { output: string }) {
    this.saved.push({ input: input.input, output: output.output });
  }
}

class MockMemoryManager {
  private memory = new MockMemory();
  async clearChatMemory() {}
  getMemory() {
    return this.memory;
  }
}

describe("updateChatMemory with tool call markers", () => {
  it("should save AI outputs containing encoded tool markers without modification", async () => {
    const messages: ChatMessage[] = [
      {
        id: "1",
        sender: USER_SENDER,
        message: "find my piano notes",
        isVisible: true,
        timestamp: null,
      },
      {
        id: "2",
        sender: AI_SENDER,
        // AI message that includes a tool call marker with encoded JSON result
        message:
          "<!--TOOL_CALL_START:localSearch-1:localSearch:Vault search:🔍::false--><!--TOOL_CALL_END:localSearch-1:ENC:%5B%7B%22title%22%3A%22Lesson%201%22%7D%5D-->\nHere are the results...",
        isVisible: true,
        timestamp: null,
      },
    ];

    const memoryManager: any = new MockMemoryManager();
    await updateChatMemory(messages, memoryManager);

    expect(memoryManager.getMemory().saved).toHaveLength(1);
    expect(memoryManager.getMemory().saved[0].input).toBe("find my piano notes");
    expect(memoryManager.getMemory().saved[0].output).toContain("<!--TOOL_CALL_START:");
    expect(memoryManager.getMemory().saved[0].output).toContain(
      "ENC:%5B%7B%22title%22%3A%22Lesson%201%22%7D%5D"
    );
  });
});
