import type { FeedbackEvidence } from "@/agentMode/session/feedback/feedbackOffer";
import type { AgentChatMessage, BackendId } from "@/agentMode/session/types";

export interface ChatStateKey<S> {
  readonly id: string;
  readonly initial: S;
}

export interface ChatView {
  readonly backendId: BackendId;
  getReportEvidence(): FeedbackEvidence;
  getDisplayMessages(): readonly AgentChatMessage[];
}

export interface ChatStateHost {
  readChatState<S>(key: ChatStateKey<S>): S;
  updateChatState<S>(key: ChatStateKey<S>, change: (state: S, chat: ChatView) => S): void;
}

export interface TurnFailure {
  errorText: string;
  error: unknown;
}

export interface PromptNote<S> {
  note: string;
  delivered: (latest: S) => S;
}

export interface ChatExtension<S> {
  readonly key: ChatStateKey<S>;
  readonly keepOnReload?: boolean;
  // A card the user can still act on must come back with the chat, so its state is saved in the chat's note and read back here; the note is the user's file, so this checks what it reads.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/941
  readonly readFromNote?: (saved: unknown) => S;
  beforePrompt?(state: S): PromptNote<S> | null;
  onTurnFailed?(state: S, chat: ChatView, failure: TurnFailure): S;
}

export type ChatStates = ReadonlyMap<string, unknown>;

export const EMPTY_CHAT_STATES: ChatStates = Object.freeze(new Map<string, unknown>());

export const EMPTY_CHAT_EXTENSIONS: readonly ChatExtension<unknown>[] = Object.freeze([]);

export type SavedChatStates = Readonly<Record<string, unknown>>;

export const NO_SAVED_CHAT_STATES: SavedChatStates = Object.freeze({});

export function defineChatExtension<S>(extension: ChatExtension<S>): ChatExtension<unknown> {
  return Object.freeze(extension);
}

export function readChatState<S>(states: ChatStates, key: ChatStateKey<S>): S {
  return states.has(key.id) ? (states.get(key.id) as S) : key.initial;
}

export function withChatState<S>(states: ChatStates, key: ChatStateKey<S>, state: S): ChatStates {
  if (readChatState(states, key) === state) return states;
  return Object.freeze(new Map(states).set(key.id, state));
}
