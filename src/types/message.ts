import { PromptContextEnvelope } from "@/context/PromptContextTypes";
import { TFile } from "obsidian";

export interface FormattedDateTime {
  epoch: number;
  display: string;
  fileName: string;
}

interface BaseSelectedTextContext {
  id: string;
  content: string;
}

export interface NoteSelectedTextContext extends BaseSelectedTextContext {
  sourceType: "note";
  noteTitle: string;
  notePath: string;
  startLine: number;
  endLine: number;
}

export interface WebSelectedTextContext extends BaseSelectedTextContext {
  sourceType: "web";
  title: string;
  url: string;
  faviconUrl?: string;
}

export type SelectedTextContext = NoteSelectedTextContext | WebSelectedTextContext;

export function isWebSelectedTextContext(ctx: SelectedTextContext): ctx is WebSelectedTextContext {
  return ctx.sourceType === "web";
}

export function isNoteSelectedTextContext(
  ctx: SelectedTextContext
): ctx is NoteSelectedTextContext {
  return ctx.sourceType === "note";
}

export interface WebTabContext {
  url: string;
  title?: string;
  faviconUrl?: string;
  isLoaded?: boolean;
  isActive?: boolean;
}

// Context chips render only these two fields, so a chip needs no `TFile`.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export interface NoteRef {
  path: string;
  basename: string;
}

export interface MessageContext {
  notes: TFile[];
  urls: string[];
  tags?: string[];
  folders?: string[];
  selectedTextContexts?: SelectedTextContext[];
  webTabs?: WebTabContext[];
}

// A replica of the host's transcript carries note references, not files.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export interface MessageContextView extends Omit<MessageContext, "notes"> {
  notes: readonly NoteRef[];
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

// A message as a renderer reads it: every `ChatMessage` field, with note references.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export type ChatMessageView = Omit<ChatMessage, "context"> & { context?: MessageContextView };

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
