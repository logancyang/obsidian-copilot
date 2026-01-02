/**
 * Discuss Feature Type Definitions
 *
 * Types for the project-focused chat interface in Projects+.
 */

import { ChatMessage } from "@/types/message";
import { TFile } from "obsidian";

/**
 * Source information for citations in AI responses
 */
export interface DiscussSource {
  /** Note path in the vault */
  path: string;
  /** Note title (basename without extension) */
  title: string;
  /** Whether the note still exists in the vault */
  exists: boolean;
}

/**
 * Extended message type for Discuss conversations
 * Extends ChatMessage with source attribution
 */
export interface DiscussMessage extends ChatMessage {
  /** Sources cited in this message (for AI responses) */
  discussSources?: DiscussSource[];
}

/**
 * Metadata stored in conversation frontmatter
 */
export interface ConversationMetadata {
  /** Unique conversation ID */
  id: string;
  /** Associated project ID */
  projectId: string;
  /** Conversation title/topic */
  title: string;
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
  /** Number of messages */
  messageCount: number;
}

/**
 * Full conversation data (metadata + messages)
 */
export interface Conversation {
  metadata: ConversationMetadata;
  messages: DiscussMessage[];
}

/**
 * Context built for a Discuss message
 */
export interface DiscussContext {
  /** Notes included in context */
  notes: TFile[];
  /** Formatted note contents for LLM */
  noteContents: string;
  /** System prompt with project context */
  systemPrompt: string;
}

/**
 * Options for scoped search within project notes
 */
export interface ScopedSearchOptions {
  /** Maximum number of results (default: 5) */
  maxResults?: number;
  /** Minimum relevance score 0-1 (default: 0.3) */
  minScore?: number;
}
