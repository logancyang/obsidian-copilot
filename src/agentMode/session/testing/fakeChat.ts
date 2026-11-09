import {
  EMPTY_CHAT_STATES,
  readChatState,
  withChatState,
  type ChatStateHost,
  type ChatStateKey,
  type ChatStates,
  type ChatView,
} from "@/agentMode/session/chatExtension";
import type { AgentChatMessage } from "@/agentMode/session/types";

export const FAKE_EVIDENCE = Object.freeze({
  backendId: "claude",
  model: "anthropic/sonnet",
  sessionId: "ses_42",
  raisedAt: "2026-11-08T00:00:00.000Z",
});

export function fakeChatView(messages: readonly AgentChatMessage[] = []): ChatView {
  return {
    backendId: "claude",
    getReportEvidence: () => FAKE_EVIDENCE,
    getDisplayMessages: () => messages,
  };
}

export interface FakeChat extends ChatStateHost {
  states: ChatStates;
}

export function fakeChat(view: ChatView = fakeChatView()): FakeChat {
  const chat: FakeChat = {
    states: EMPTY_CHAT_STATES,
    readChatState: <S>(key: ChatStateKey<S>): S => readChatState(chat.states, key),
    updateChatState: <S>(key: ChatStateKey<S>, change: (state: S, view: ChatView) => S): void => {
      chat.states = withChatState(chat.states, key, change(chat.readChatState(key), view));
    },
  };
  return chat;
}
