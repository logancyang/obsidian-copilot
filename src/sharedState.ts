import { useState, useEffect } from 'react';

export interface ChatMessage {
  message: string;
  sender: string;
}

class SharedState {
  chatHistory: ChatMessage[] = [];

  addMessage(message: ChatMessage): void {
    this.chatHistory.push(message);
  }

  getMessages(): ChatMessage[] {
    return this.chatHistory;
  }
}

export default SharedState;

export function useSharedState(sharedState: SharedState): [ChatMessage[], (message: ChatMessage) => void] {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(sharedState.getMessages());

  useEffect(() => {
    setChatHistory(sharedState.getMessages());
  }, []);

  const addMessage = (message: ChatMessage) => {
    sharedState.addMessage(message);
    setChatHistory([...sharedState.getMessages()]);
  };

  return [chatHistory, addMessage];
}
