import { ChatMessage } from '@/sharedState';
import { USER_SENDER } from '@/constants';

// Returns the last N messages from the chat history,
// last one being the new user message
export const getChatContext = (chatHistory: ChatMessage[], contextSize: number) => {
  if (chatHistory.length === 0) {
    return [];
  }

  const lastUserMessageIndex = chatHistory.slice().reverse().findIndex(msg => msg.sender === USER_SENDER);

  if (lastUserMessageIndex === -1) {
    // No user messages found, return an empty array
    return [];
  }

  const lastIndex = chatHistory.length - 1 - lastUserMessageIndex;
  const startIndex = Math.max(0, lastIndex - contextSize + 1);

  const chatContext = chatHistory.slice(startIndex, lastIndex + 1);
  return chatContext;
};
