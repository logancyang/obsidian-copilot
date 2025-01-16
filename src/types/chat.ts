import { TFile } from "obsidian";
import { FormattedDateTime } from "../utils";

export interface ChatMessage {
  message: string;
  originalMessage?: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  sources?: { title: string; score: number }[];
  content?: any[];
  context?: {
    notes: TFile[];
    urls: string[];
  };
}

export interface SharedStateType {
  chatHistory: ChatMessage[];
  addMessage(message: ChatMessage): void;
  getMessages(): ChatMessage[];
  clearChatHistory(): void;
}
