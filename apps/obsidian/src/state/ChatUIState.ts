import { ChainType } from "@/chainType";
import { logInfo } from "@/logger";
import { ChatManager } from "@/core/ChatManager";
import { MessageContent } from "@/imageProcessing/imageProcessor";
import { ChatMessage, MessageContext } from "@/types/message";
import { TFile } from "obsidian";

export type ChatMessageContent = NonNullable<ChatMessage["content"]>;

export interface ChatUIState {
  subscribe(listener: () => void): () => void;
  sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote?: boolean,
    includeActiveWebTab?: boolean,
    content?: MessageContent[],
    updateLoadingMessage?: (message: string) => void
  ): Promise<string>;
  editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote?: boolean
  ): Promise<boolean>;
  regenerateMessage(
    messageId: string,
    onUpdateCurrentMessage: (message: string) => void,
    onAddMessage: (message: ChatMessage) => void
  ): Promise<boolean>;
  deleteMessage(messageId: string): Promise<boolean>;
  clearMessages(): void;
  truncateAfterMessageId(messageId: string): Promise<void>;
  getMessages(): ChatMessage[];
  getSourcePath(): string;
  getMessage(id: string): ChatMessage | undefined;
  getLLMMessage(id: string): ChatMessage | undefined;
  getLLMMessages(): ChatMessage[];
  readonly chatHistory: ChatMessage[];
  addMessage(message: ChatMessage): void;
  clearChatHistory(): void;
  replaceMessages(messages: ChatMessage[]): Promise<void>;
  getDebugInfo(): unknown;
  loadMessages(messages: ChatMessage[]): Promise<void>;
  saveChat(modelKey: string): Promise<void>;
  loadChatHistory(file: TFile): Promise<void>;
}

export class ChatManagerChatUIState implements ChatUIState {
  private listeners: Set<() => void> = new Set();

  constructor(private chatManager: ChatManager) {
    this.chatManager.setOnMessageCreatedCallback(() => {
      this.notifyListeners();
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logInfo(`[ChatUIState] Error in listener:`, error);
      }
    });
  }

  async sendMessage(
    displayText: string,
    context: MessageContext,
    chainType: ChainType,
    includeActiveNote: boolean = false,
    includeActiveWebTab: boolean = false,
    content?: MessageContent[],
    updateLoadingMessage?: (message: string) => void
  ): Promise<string> {
    const messageId = await this.chatManager.sendMessage(
      displayText,
      context,
      chainType,
      includeActiveNote,
      includeActiveWebTab,
      content,
      updateLoadingMessage
    );
    this.notifyListeners();
    return messageId;
  }

  async editMessage(
    messageId: string,
    newText: string,
    chainType: ChainType,
    includeActiveNote: boolean = false
  ): Promise<boolean> {
    const success = await this.chatManager.editMessage(
      messageId,
      newText,
      chainType,
      includeActiveNote
    );
    if (success) {
      this.notifyListeners();
    }
    return success;
  }

  async regenerateMessage(
    messageId: string,
    onUpdateCurrentMessage: (message: string) => void,
    onAddMessage: (message: ChatMessage) => void
  ): Promise<boolean> {
    const success = await this.chatManager.regenerateMessage(
      messageId,
      onUpdateCurrentMessage,
      (message) => {
        onAddMessage(message);
        this.notifyListeners();
      },
      () => {
        this.notifyListeners();
      }
    );
    if (success) {
      this.notifyListeners();
    }
    return success;
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const success = await this.chatManager.deleteMessage(messageId);
    if (success) {
      this.notifyListeners();
    }
    return success;
  }

  clearMessages(): void {
    this.chatManager.clearMessages();
    this.notifyListeners();
  }

  async truncateAfterMessageId(messageId: string): Promise<void> {
    await this.chatManager.truncateAfterMessageId(messageId);
    this.notifyListeners();
  }

  getSourcePath(): string {
    return this.chatManager.getSourcePath();
  }

  getMessages(): ChatMessage[] {
    return this.chatManager.getDisplayMessages();
  }

  getMessage(id: string): ChatMessage | undefined {
    return this.chatManager.getMessage(id);
  }

  getLLMMessage(id: string): ChatMessage | undefined {
    return this.chatManager.getLLMMessage(id);
  }

  getLLMMessages(): ChatMessage[] {
    return this.chatManager.getLLMMessages();
  }

  get chatHistory(): ChatMessage[] {
    return this.getMessages();
  }

  addMessage(message: ChatMessage): void {
    this.chatManager.addMessage(message);
    this.notifyListeners();
  }

  clearChatHistory(): void {
    this.clearMessages();
  }

  async replaceMessages(messages: ChatMessage[]): Promise<void> {
    await this.chatManager.loadMessages(messages);
    this.notifyListeners();
  }

  getDebugInfo() {
    return this.chatManager.getDebugInfo();
  }

  async loadMessages(messages: ChatMessage[]): Promise<void> {
    await this.chatManager.loadMessages(messages);
    this.notifyListeners();
  }

  async saveChat(modelKey: string): Promise<void> {
    await this.chatManager.saveChat(modelKey);
    this.notifyListeners();
  }

  async loadChatHistory(file: TFile): Promise<void> {
    await this.chatManager.loadChatHistory(file);
    this.notifyListeners();
  }
}
