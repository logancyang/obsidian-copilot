import { AI_SENDER, USER_SENDER } from "@/constants";
import { ChatMessage } from "@/sharedState";
import { stringToFormattedDateTime } from "@/utils";
import MemoryManager from "./LLMProviders/memoryManager";

export function parseChatContent(content: string): ChatMessage[] {
  const lines = content.split("\n");
  const messages: ChatMessage[] = [];
  let currentSender = "";
  let currentMessage = "";
  let currentTimestamp = "";

  for (const line of lines) {
    if (line.startsWith("**user**:") || line.startsWith("**ai**:")) {
      if (currentSender && currentMessage) {
        messages.push({
          sender: currentSender === USER_SENDER ? USER_SENDER : AI_SENDER,
          message: currentMessage.trim(),
          isVisible: true,
          timestamp: currentTimestamp ? stringToFormattedDateTime(currentTimestamp) : null,
        });
      }
      currentSender = line.startsWith("**user**:") ? USER_SENDER : AI_SENDER;
      currentMessage = line.substring(line.indexOf(":") + 1).trim();
      currentTimestamp = "";
    } else if (line.startsWith("[Timestamp:")) {
      currentTimestamp = line.substring(11, line.length - 1).trim();
    } else {
      currentMessage += "\n" + line;
    }
  }

  if (currentSender && currentMessage) {
    messages.push({
      sender: currentSender === USER_SENDER ? USER_SENDER : AI_SENDER,
      message: currentMessage.trim(),
      isVisible: true,
      timestamp: currentTimestamp ? stringToFormattedDateTime(currentTimestamp) : null,
    });
  }

  return messages;
}

export async function updateChatMemory(
  messages: ChatMessage[],
  memoryManager: MemoryManager
): Promise<void> {
  // Clear existing memory
  await memoryManager.clearChatMemory();

  // Process each message in sequence
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];

    if (msg.sender === USER_SENDER) {
      const nextMsg = messages[i + 1];
      if (nextMsg?.sender === AI_SENDER) {
        await memoryManager
          .getMemory()
          .saveContext({ input: msg.message }, { output: nextMsg.message });
      }
    }
  }
}
