import {
  readChatState,
  type ChatStateHost,
  type ChatStateKey,
  type ChatStates,
} from "@/agentMode/session/chatExtension";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";
import type CopilotPlugin from "@/main";
import React from "react";

export interface ChatCardContext {
  plugin: CopilotPlugin;
  chat: ChatStateHost;
}

export interface PlacedChatCard {
  id: string;
  afterUserMessageId: string | null;
}

export interface ChatCardSlot<S> {
  key: ChatStateKey<S>;
  place(state: S, messages: ReadonlyArray<AgentChatMessage>): readonly PlacedChatCard[];
  render(state: S, cardId: string, ctx: ChatCardContext): React.ReactNode;
}

export const NO_PLACED_CHAT_CARDS: readonly PlacedChatCard[] = Object.freeze([]);

export function defineChatCardSlot<S>(slot: ChatCardSlot<S>): ChatCardSlot<unknown> {
  return Object.freeze(slot);
}

export function findTrailingCardIndex(
  messages: ReadonlyArray<AgentChatMessage>,
  afterUserMessageId: string | null
): number {
  const start = messages.findIndex((message) => message.id === afterUserMessageId);
  if (start === -1) return messages.length - 1;
  const nextUser = messages.findIndex(
    (message, index) => index > start && message.sender === USER_SENDER
  );
  return nextUser === -1 ? messages.length - 1 : nextUser - 1;
}

export function placeChatCards(
  visible: ReadonlyArray<AgentChatMessage>,
  messages: ReadonlyArray<AgentChatMessage>,
  states: ChatStates,
  ctx: ChatCardContext,
  slots: readonly ChatCardSlot<unknown>[]
): ReadonlyMap<number, readonly React.ReactNode[]> {
  const byIndex = new Map<number, React.ReactNode[]>();
  for (const slot of slots) {
    const state = readChatState(states, slot.key);
    for (const card of slot.place(state, messages)) {
      const index = findTrailingCardIndex(visible, card.afterUserMessageId);
      if (index === -1) continue;
      byIndex.set(index, [
        ...(byIndex.get(index) ?? []),
        <React.Fragment key={`${slot.key.id}:${card.id}`}>
          {slot.render(state, card.id, ctx)}
        </React.Fragment>,
      ]);
    }
  }
  return byIndex;
}
