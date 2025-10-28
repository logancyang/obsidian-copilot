import { PromptContextEnvelope } from "@/context/PromptContextTypes";
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
  tags?: string[];
  folders?: string[];
  selectedTextContexts?: SelectedTextContext[];
}

/**
 * Token usage statistics from LLM providers
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Response metadata from LLM providers
 */
export interface ResponseMetadata {
  /** Whether the response was truncated due to token limits */
  wasTruncated?: boolean;

  /** Token usage statistics */
  tokenUsage?: TokenUsage;
}

/**
 * Streaming response result from chain runners
 * Similar to ResponseMetadata but with required fields and content
 */
export interface StreamingResult {
  /** The streamed content */
  content: string;

  /** Whether the response was truncated (required for streaming) */
  wasTruncated: boolean;

  /** Token usage statistics (may be null if not yet available) */
  tokenUsage: TokenUsage | null;
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
  sources?: { title: string; path: string; score: number; explanation?: any }[];

  /** Rich content (images, etc.) */
  content?: any[];

  /** Context attached to this message */
  context?: MessageContext;

  /** Layered prompt context envelope */
  contextEnvelope?: PromptContextEnvelope;

  /** Whether this is an error message */
  isErrorMessage?: boolean;

  /** Whether context needs to be reprocessed (after editing) */
  needsContextReprocessing?: boolean;

  /** Response metadata from LLM (for AI messages) */
  responseMetadata?: ResponseMetadata;
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

  /**
   * TRANSITIONAL FIELD - Legacy concatenated context (Phase 1)
   *
   * For user messages: displayText + context (notes, tags, folders, URLs) concatenated
   * For AI messages: same as displayText
   *
   * DEPRECATION PLAN:
   * - Phase 1 (Current): Both processedText and contextEnvelope populated
   * - Phase 2 (After ChainRunner migration): Computed from contextEnvelope.serializedText
   * - Phase 3 (Future): Remove this field entirely, use contextEnvelope only
   *
   * DO NOT USE FOR:
   * - Chat history (use displayText to avoid context duplication)
   * - New LLM requests (use contextEnvelope)
   *
   * USE ONLY FOR:
   * - Legacy ChainRunners during transition
   * - Backward compatibility with old saved chats
   * - Fallback when envelope building fails
   */
  processedText: string;

  sender: string;
  timestamp: FormattedDateTime;
  context?: MessageContext;

  /**
   * NEW: Structured L1-L5 layers for prompt construction
   * This is the primary format for LLM requests going forward.
   */
  contextEnvelope?: PromptContextEnvelope;

  isVisible: boolean;
  isErrorMessage?: boolean;
  sources?: { title: string; path: string; score: number; explanation?: any }[];
  content?: any[];
  responseMetadata?: ResponseMetadata;
}
