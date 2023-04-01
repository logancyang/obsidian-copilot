// This shared state stores the chat history until the user
// clicks "New Chat" to reset it
export interface ChatMessage {
  message: string;
  sender: string;
}

export class SharedState {
  chatHistory: ChatMessage[] = [];

  addMessage(message: ChatMessage): void {
    this.chatHistory.push(message);
  }

  getMessages(): ChatMessage[] {
    return this.chatHistory;
  }
}