import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { TFile } from "obsidian";
import type {
  ChatSelectedTextContext,
  NoteSelectedTextContext,
  SelectedTextContext,
  WebSelectedTextContext,
  WebTabContext,
} from "@copilot/protocol/messageContext";
import type { FormattedDateTime } from "@copilot/protocol/messages";

export type {
  ChatSelectedTextContext,
  NoteSelectedTextContext,
  SelectedTextContext,
  WebSelectedTextContext,
  WebTabContext,
} from "@copilot/protocol/messageContext";
export type { FormattedDateTime } from "@copilot/protocol/messages";

export function isWebSelectedTextContext(ctx: SelectedTextContext): ctx is WebSelectedTextContext {
  return ctx.sourceType === "web";
}

export function isChatSelectedTextContext(
  ctx: SelectedTextContext
): ctx is ChatSelectedTextContext {
  return ctx.sourceType === "chat";
}

export function isNoteSelectedTextContext(
  ctx: SelectedTextContext
): ctx is NoteSelectedTextContext {
  return ctx.sourceType === "note";
}

export interface MessageContext {
  notes: TFile[];
  urls: string[];
  tags?: string[];
  folders?: string[];
  selectedTextContexts?: SelectedTextContext[];
  webTabs?: WebTabContext[];
  agents?: string[];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ResponseMetadata {
  wasTruncated?: boolean;

  tokenUsage?: TokenUsage;
}

export interface StreamingResult {
  content: string;

  wasTruncated: boolean;

  tokenUsage: TokenUsage | null;
}

export interface ChatMessage {
  id?: string;

  message: string;

  originalMessage?: string;

  sender: string;

  timestamp: FormattedDateTime | null;

  isVisible: boolean;

  sources?: { title: string; path: string; score: number; explanation?: unknown }[];

  content?: unknown[];

  context?: MessageContext;

  contextEnvelope?: PromptContextEnvelope;

  isErrorMessage?: boolean;

  needsContextReprocessing?: boolean;

  responseMetadata?: ResponseMetadata;
}

export type NewChatMessage = Omit<ChatMessage, "id"> & { id?: string };

export interface StoredMessage {
  id: string;
  displayText: string;

  processedText: string;

  sender: string;
  timestamp: FormattedDateTime;
  context?: MessageContext;

  contextEnvelope?: PromptContextEnvelope;

  isVisible: boolean;
  isErrorMessage?: boolean;
  sources?: { title: string; path: string; score: number; explanation?: unknown }[];
  content?: unknown[];
  responseMetadata?: ResponseMetadata;
}
