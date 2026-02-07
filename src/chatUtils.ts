import { AI_SENDER, USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import MemoryManager from "./LLMProviders/memoryManager";

export async function updateChatMemory(
  messages: ChatMessage[],
  memoryManager: MemoryManager
): Promise<void> {
  // Clear existing memory
  await memoryManager.clearChatMemory();

  // Process each message in sequence
  // Use memoryManager.saveContext to apply compaction for any old uncompacted messages
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];

    if (msg.sender === USER_SENDER) {
      const nextMsg = messages[i + 1];
      if (nextMsg?.sender === AI_SENDER) {
        await memoryManager.saveContext({ input: msg.message }, { output: nextMsg.message });
      }
    }
  }
}
