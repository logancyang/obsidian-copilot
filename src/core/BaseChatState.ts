import { ChatMessage, NewChatMessage } from "@/types/message";

/**
 * Display message interface for UI rendering
 * This represents the subset of ChatMessage needed for display purposes
 */
export interface DisplayMessage {
  /** Unique identifier for the message */
  id?: string;

  /** The message content to display */
  message: string;

  /** Message sender identifier ("user", "AI", etc.) */
  sender: string;

  /** Timestamp for the message */
  timestamp?: { display: string; epoch: number } | null;

  /** Whether this message should be shown in UI */
  isVisible: boolean;

  /** Whether this is an error message */
  isErrorMessage?: boolean;

  /** Sources cited in the response (for AI messages) */
  sources?: { title: string; path: string; score: number }[];

  /** Rich content (images, etc.) */
  content?: any[];
}

/**
 * BaseChatState - Abstract interface for chat state management
 *
 * This interface defines the contract for managing chat messages.
 * It can be implemented by different chat state managers to support
 * various use cases (main Copilot chat, Projects+ Discuss, etc.)
 *
 * @example
 * ```typescript
 * class MyChatState implements BaseChatState {
 *   private messages: DisplayMessage[] = [];
 *   private subscribers = new Set<() => void>();
 *
 *   getMessages(): DisplayMessage[] {
 *     return [...this.messages];
 *   }
 *
 *   addMessage(message: DisplayMessage): string {
 *     const id = generateId();
 *     this.messages.push({ ...message, id });
 *     this.notifySubscribers();
 *     return id;
 *   }
 *
 *   // ... other methods
 * }
 * ```
 */
export interface BaseChatState {
  /**
   * Get all visible messages for display
   * @returns Array of display messages
   */
  getMessages(): DisplayMessage[];

  /**
   * Add a new message to the chat
   * @param message - The message to add (can be DisplayMessage or NewChatMessage)
   * @returns The ID of the added message
   */
  addMessage(message: DisplayMessage | NewChatMessage): string;

  /**
   * Update an existing message
   * @param id - The message ID to update
   * @param updates - Partial updates to apply
   * @returns True if update was successful, false if message not found
   */
  updateMessage(id: string, updates: Partial<DisplayMessage>): boolean;

  /**
   * Delete a message
   * @param id - The message ID to delete
   * @returns True if deletion was successful, false if message not found
   */
  deleteMessage?(id: string): boolean;

  /**
   * Clear all messages
   */
  clearMessages(): void;

  /**
   * Subscribe to state changes
   * @param callback - Function to call when state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: () => void): () => void;
}

/**
 * Extended interface for chat states that need LLM-specific functionality
 */
export interface LLMChatState extends BaseChatState {
  /**
   * Get messages formatted for LLM consumption
   * @returns Array of messages ready for LLM context
   */
  getLLMMessages(): ChatMessage[];

  /**
   * Get a specific message for LLM processing
   * @param id - The message ID
   * @returns The message formatted for LLM, or undefined if not found
   */
  getLLMMessage?(id: string): ChatMessage | undefined;

  /**
   * Update the processed text for a message (after context processing)
   * @param id - The message ID
   * @param processedText - The new processed text
   * @returns True if update was successful
   */
  updateProcessedText?(id: string, processedText: string): boolean;
}

/**
 * Simple in-memory implementation of BaseChatState
 * Useful for testing or simple use cases
 *
 * @example
 * ```typescript
 * const chatState = new SimpleChatState();
 *
 * // Subscribe to changes
 * const unsubscribe = chatState.subscribe(() => {
 *   console.log('Messages changed:', chatState.getMessages());
 * });
 *
 * // Add a message
 * chatState.addMessage({
 *   message: 'Hello!',
 *   sender: 'user',
 *   isVisible: true,
 * });
 *
 * // Cleanup
 * unsubscribe();
 * ```
 */
export class SimpleChatState implements BaseChatState {
  private messages: DisplayMessage[] = [];
  private subscribers = new Set<() => void>();
  private idCounter = 0;

  /**
   * Generate a unique message ID
   */
  private generateId(): string {
    return `msg-${Date.now()}-${++this.idCounter}`;
  }

  /**
   * Notify all subscribers of state changes
   */
  private notifySubscribers(): void {
    this.subscribers.forEach((callback) => callback());
  }

  /**
   * Get all visible messages
   */
  getMessages(): DisplayMessage[] {
    return this.messages.filter((m) => m.isVisible);
  }

  /**
   * Add a new message
   */
  addMessage(message: DisplayMessage | NewChatMessage): string {
    const id = message.id || this.generateId();

    // Normalize message to DisplayMessage format
    const displayMessage: DisplayMessage = {
      id,
      message: "message" in message ? message.message : "",
      sender: message.sender,
      isVisible: message.isVisible !== false,
      isErrorMessage: message.isErrorMessage,
      sources: message.sources,
      content: message.content,
    };

    // Add timestamp if available
    if ("timestamp" in message && message.timestamp) {
      displayMessage.timestamp = {
        display: message.timestamp.display || "",
        epoch: message.timestamp.epoch || Date.now(),
      };
    }

    this.messages.push(displayMessage);
    this.notifySubscribers();
    return id;
  }

  /**
   * Update an existing message
   */
  updateMessage(id: string, updates: Partial<DisplayMessage>): boolean {
    const message = this.messages.find((m) => m.id === id);
    if (!message) {
      return false;
    }

    Object.assign(message, updates);
    this.notifySubscribers();
    return true;
  }

  /**
   * Delete a message
   */
  deleteMessage(id: string): boolean {
    const index = this.messages.findIndex((m) => m.id === id);
    if (index === -1) {
      return false;
    }

    this.messages.splice(index, 1);
    this.notifySubscribers();
    return true;
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messages = [];
    this.notifySubscribers();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
}

/**
 * React hook for using BaseChatState
 *
 * @example
 * ```tsx
 * function ChatComponent() {
 *   const [chatState] = useState(() => new SimpleChatState());
 *   const messages = useChatState(chatState);
 *
 *   return (
 *     <MessageList
 *       messages={messages}
 *       // ...
 *     />
 *   );
 * }
 * ```
 */
export function useChatState(chatState: BaseChatState): DisplayMessage[] {
  const [messages, setMessages] = React.useState<DisplayMessage[]>(() => chatState.getMessages());

  React.useEffect(() => {
    // Initial sync
    setMessages(chatState.getMessages());

    // Subscribe to changes
    const unsubscribe = chatState.subscribe(() => {
      setMessages(chatState.getMessages());
    });

    return unsubscribe;
  }, [chatState]);

  return messages;
}

// React import for the hook
import React from "react";
