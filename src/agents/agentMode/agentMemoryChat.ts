import type { AgentFileManager } from "@/agents/AgentFileManager";
import type { AgentMemoryNoticeKind } from "@/agents/types";
import {
  defineChatExtension,
  type ChatStateKey,
  type ChatView,
  type PromptNote,
} from "@/agentMode/session/chatExtension";
import { loadAgentMemoryInjection } from "@/agentMode/session/sessionAgent";
import { USER_SENDER } from "@/constants";
import { logWarn } from "@/logger";

export interface AgentMemoryNotice {
  readonly kind: AgentMemoryNoticeKind;
  readonly agentName: string;
  readonly path: string;
}

export interface ShownAgentMemoryNotice extends AgentMemoryNotice {
  readonly afterUserTurn: number;
}

export interface AgentMemoryChatState {
  readonly injectedFingerprint: string | null;
  readonly memorizedThroughTurn: number;
  readonly notice: ShownAgentMemoryNotice | null;
  readonly heldNotice: AgentMemoryNotice | null;
}

export const AGENT_MEMORY: ChatStateKey<AgentMemoryChatState> = Object.freeze({
  id: "agent-memory",
  initial: Object.freeze({
    injectedFingerprint: null,
    memorizedThroughTurn: 0,
    notice: null,
    heldNotice: null,
  }),
});

export const MEMORIZED_THROUGH_TURN_KEY = "memorizedThroughTurn";

export function createAgentMemoryExtension(files: AgentFileManager) {
  return defineChatExtension({
    key: AGENT_MEMORY,
    noteField: {
      key: MEMORIZED_THROUGH_TURN_KEY,
      save: (state) => (state.memorizedThroughTurn > 0 ? state.memorizedThroughTurn : null),
      restore: markMemorizedThrough,
    },
    beforePrompt: (state, chat) => {
      const slug = chat.getAgent().slug;
      return slug ? takeMemoryNote(files, slug, state.injectedFingerprint) : null;
    },
  });
}

async function takeMemoryNote(
  files: AgentFileManager,
  slug: string,
  injectedFingerprint: string | null
): Promise<PromptNote<AgentMemoryChatState> | null> {
  try {
    const record = await files.readAgent(slug);
    const memory = record ? await loadAgentMemoryInjection(files, record.agent) : null;
    if (!memory || memory.fingerprint === injectedFingerprint) return null;
    return {
      note: memory.block,
      leads: true,
      delivered: (latest) => ({ ...latest, injectedFingerprint: memory.fingerprint }),
    };
  } catch (error) {
    logWarn(`[Agents] Could not read memory for "${slug}"`, error);
    return null;
  }
}

export function markMemorizedThrough(
  state: AgentMemoryChatState,
  throughTurn: number
): AgentMemoryChatState {
  if (!Number.isFinite(throughTurn) || throughTurn <= state.memorizedThroughTurn) return state;
  return { ...state, memorizedThroughTurn: Math.floor(throughTurn) };
}

export function showMemoryNotice(
  state: AgentMemoryChatState,
  notice: AgentMemoryNotice,
  chat: ChatView
): AgentMemoryChatState {
  return { ...state, notice: { ...notice, afterUserTurn: userTurnCount(chat) } };
}

export function holdMemoryNotice(
  state: AgentMemoryChatState,
  notice: AgentMemoryNotice
): AgentMemoryChatState {
  return { ...state, heldNotice: notice };
}

export function releaseHeldMemoryNotice(
  state: AgentMemoryChatState,
  chat: ChatView
): AgentMemoryChatState {
  if (!state.heldNotice) return state;
  return { ...showMemoryNotice(state, state.heldNotice, chat), heldNotice: null };
}

function userTurnCount(chat: ChatView): number {
  return chat.getDisplayMessages().filter((message) => message.sender === USER_SENDER).length;
}
