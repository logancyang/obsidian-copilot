import { TFile } from "obsidian";

/**
 * Formatted timestamp with multiple representations
 */
export interface FormattedDateTime {
  epoch: number;
  display: string;
  fileName: string;
}

/**
 * Context for selected text from notes
 */
export interface SelectedTextContext {
  content: string;
  noteTitle: string;
  notePath: string;
  startLine: number;
  endLine: number;
  id: string;
}

/**
 * Context information attached to messages
 */
export interface MessageContext {
  notes: TFile[];
  urls: string[];
  selectedTextContexts?: SelectedTextContext[];
}

/**
 * Core chat message interface
 * This represents both display and LLM messages with different content
 */
export interface ChatMessage {
  /** Unique identifier for the message */
  id?: string;

  /** The message content (display text for UI, processed text for LLM) */
  message: string;

  /** Original user input before processing (for LLM messages) */
  originalMessage?: string;

  /** Message sender ("user", "AI", etc.) */
  sender: string;

  /** When the message was created */
  timestamp: FormattedDateTime | null;

  /** Whether this message should be shown in UI */
  isVisible: boolean;

  /** Sources cited in the response */
  sources?: { title: string; score: number }[];

  /** Rich content (images, etc.) */
  content?: any[];

  /** Context attached to this message */
  context?: MessageContext;

  /** Whether this is an error message */
  isErrorMessage?: boolean;

  /** Whether context needs to be reprocessed (after editing) */
  needsContextReprocessing?: boolean;
}

/**
 * Type for message creation without ID (ID will be auto-generated)
 */
export type NewChatMessage = Omit<ChatMessage, "id"> & { id?: string };

/**
 * Internal storage format - single source of truth
 * Each message stores both display and processed versions
 */
export interface StoredMessage {
  id: string;
  displayText: string; // What user typed/what AI responded
  processedText: string; // For user messages: with context added. For AI: same as display
  sender: string;
  timestamp: FormattedDateTime;
  context?: MessageContext;
  isVisible: boolean;
  isErrorMessage?: boolean;
  sources?: { title: string; score: number }[];
  content?: any[];
}
