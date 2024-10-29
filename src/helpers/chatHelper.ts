// helper contains business-related tools；
// generally, util contains business-independent tools

import { AI_SENDER, USER_SENDER } from "@/constants";
import { ChatMessage } from "@/services/sharedState";
import { stringToFormattedDateTime } from "@/utils";
import MemoryManager from "../LLMProviders/memoryManager";

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
  await memoryManager.clearChatMemory();

  let lastUserMessage = "";
  for (const msg of messages) {
    if (msg.sender === USER_SENDER) {
      lastUserMessage = msg.message;
    } else if (msg.sender === AI_SENDER && lastUserMessage) {
      await memoryManager
        .getMemory()
        .saveContext({ input: lastUserMessage }, { output: msg.message });
      lastUserMessage = ""; // Reset after saving
    }
  }

  // If there's a trailing user message, save it with an empty AI response
  if (lastUserMessage) {
    await memoryManager.getMemory().saveContext({ input: lastUserMessage }, { output: "" });
  }
}
