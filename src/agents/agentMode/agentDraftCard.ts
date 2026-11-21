import {
  defineChatExtension,
  type ChatStateHost,
  type ChatStateKey,
} from "@/agentMode/session/chatExtension";
import { USER_SENDER } from "@/constants";

export interface AgentDraft {
  name: string;
  title: string;
  instruction: string;
}

export interface AgentDraftCard {
  draft: AgentDraft;
  draftedBy: string | null;
  afterUserTurn: number;
}

// One draft per chat: a newer draft replaces the card, and "Not now" clears it, so two cards can never open the dialog with different drafts.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/941
export const AGENT_DRAFT_CARD: ChatStateKey<AgentDraftCard | null> = Object.freeze({
  id: "teammate-draft",
  initial: null,
});

export const AGENT_DRAFT_CARD_EXTENSION = defineChatExtension({
  key: AGENT_DRAFT_CARD,
  keepOnReload: true,
  readFromNote: readAgentDraftCard,
});

export function readAgentDraft(value: unknown): AgentDraft | null {
  const { name, title = "", instruction = "" } = (value ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof title !== "string" || typeof instruction !== "string") return null;
  return { name: name.trim(), title: title.trim(), instruction: instruction.trim() };
}

function readAgentDraftCard(saved: unknown): AgentDraftCard | null {
  const { draft, draftedBy, afterUserTurn } = (saved ?? {}) as Record<string, unknown>;
  const read = readAgentDraft(draft);
  if (!read || !(draftedBy === null || typeof draftedBy === "string")) return null;
  if (!Number.isSafeInteger(afterUserTurn)) return null;
  return { draft: read, draftedBy, afterUserTurn: afterUserTurn as number };
}

// A Reload or a reopened note gives the chat's messages new IDs, so the card is placed by its user turn.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/941
export function showAgentDraft(
  chat: ChatStateHost,
  draft: AgentDraft,
  draftedBy: string | null
): void {
  chat.updateChatState(AGENT_DRAFT_CARD, (_, view) => ({
    draft,
    draftedBy,
    afterUserTurn: view.getDisplayMessages().filter((message) => message.sender === USER_SENDER)
      .length,
  }));
}

export function dismissAgentDraft(chat: ChatStateHost): void {
  chat.updateChatState(AGENT_DRAFT_CARD, () => null);
}
