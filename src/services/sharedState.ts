import { FormattedDateTime } from "@/utils";

export interface ChatMessage {
  message: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
}

class SharedState {
  chatHistory: ChatMessage[] = [];

  addMessage(message: ChatMessage): void {
    this.chatHistory.push(message);
  }

  getMessages(): ChatMessage[] {
    return this.chatHistory;
  }

  clearChatHistory(): void {
    this.chatHistory = [];
  }
}

export default SharedState;
