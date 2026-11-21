import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import { buildAgentModelChoices } from "@/agentMode/ui/agentModelPickerHelpers";
import { defineChatCardSlot, NO_PLACED_CHAT_CARDS } from "@/agentMode/ui/chatCards";
import { startCustomAgentChat } from "@/agents/agentMode/agentChats";
import {
  AGENT_DRAFT_CARD,
  dismissAgentDraft,
  type AgentDraft,
  type AgentDraftCard as AgentDraftCardState,
} from "@/agents/agentMode/agentDraftCard";
import type { CustomAgentStore } from "@/agents/CustomAgentStore";
import { NEUTRAL_FACE_SRC } from "@/agents/customAgentFiles";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { AgentFace } from "@/agents/ui/AgentFace";
import { CreateAgentModal } from "@/agents/ui/CreateAgentModal";
import { CustomAgentStoreContext } from "@/agents/ui/useCustomAgents";
import { Button } from "@/components/ui/button";
import { ClampedContent } from "@/components/ui/clamped-content";
import { USER_SENDER } from "@/constants";
import { useChatInput } from "@/context/ChatInputContext";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { UserPlus } from "lucide-react";
import { Notice } from "obsidian";
import React, { useContext } from "react";

export interface AgentDraftCardProps {
  draft: AgentDraft;
  onDismiss: () => void;
  onReview: () => void;
}

export function AgentDraftCard({
  draft,
  onDismiss,
  onReview,
}: AgentDraftCardProps): React.ReactElement {
  return (
    <div
      data-testid="agent-draft-card"
      className="tw-mx-3 tw-my-2 tw-flex tw-w-[calc(100%-1.5rem)] tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-2.5 tw-text-sm"
    >
      <div className="tw-flex tw-items-center tw-gap-2 tw-font-semibold">
        <UserPlus className="tw-size-4 tw-shrink-0" />
        New teammate draft
      </div>
      <div className="tw-flex tw-items-center tw-gap-2">
        <AgentFace src={NEUTRAL_FACE_SRC} size="m" />
        <div className="tw-min-w-0">
          <div className="tw-truncate tw-font-semibold">{draft.name}</div>
          {draft.title && (
            <div className="tw-truncate tw-text-ui-smaller tw-text-muted">{draft.title}</div>
          )}
        </div>
      </div>
      {draft.instruction && (
        <div className="tw-text-muted">
          <ClampedContent collapsedClassName="tw-max-h-[3lh]">
            <div className="tw-whitespace-pre-wrap tw-break-words">{draft.instruction}</div>
          </ClampedContent>
        </div>
      )}
      <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Not now
        </Button>
        <Button variant="default" size="sm" onClick={onReview}>
          Review and create…
        </Button>
      </div>
    </div>
  );
}

interface AgentDraftChatCardProps {
  card: AgentDraftCardState;
  plugin: CopilotPlugin;
  chat: ChatStateHost;
}

function AgentDraftChatCard({ card, plugin, chat }: AgentDraftChatCardProps) {
  const { focusInput } = useChatInput();
  const store = useContext(CustomAgentStoreContext);
  if (useCustomAgentsGate() !== "full") return null;
  return (
    <AgentDraftCard
      draft={card.draft}
      onDismiss={() => dismissAgentDraft(chat)}
      onReview={() => openAgentDraft(plugin, store, chat, card, focusInput)}
    />
  );
}

// Only the user creates an agent and approves its instruction, so the draft opens the same dialog as "+", and Create lands on the new agent's home; the card goes only once its agent exists, so a dialog closed by accident can be opened again.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/941
function openAgentDraft(
  plugin: CopilotPlugin,
  store: CustomAgentStore | undefined,
  chat: ChatStateHost,
  { draft, draftedBy }: AgentDraftCardState,
  focusInput: () => void
) {
  const manager = plugin.agentSessionManager;
  if (!store || !manager) return;
  const drafter = store.getAgents().find((agent) => agent.slug === draftedBy);
  new CreateAgentModal(plugin.app, {
    store,
    models: buildAgentModelChoices({
      manager,
      descriptors: listBackendDescriptors(),
      settings: getSettings(),
    }),
    initialValues: draft,
    draftedBy: drafter && { name: drafter.name, faceSrc: drafter.faceSrc },
    onCreated: (slug) => {
      dismissAgentDraft(chat);
      const agent = store.getAgents().find((candidate) => candidate.slug === slug);
      if (!agent) return;
      startCustomAgentChat(manager, agent)
        .then(focusInput)
        .catch((error: unknown) => {
          logError("[Custom agents] new chat with a drafted agent failed", error);
          new Notice(`Couldn't start a chat with ${agent.name}. Please try again.`);
        });
    },
  }).open();
}

export const agentDraftCardSlot = defineChatCardSlot({
  key: AGENT_DRAFT_CARD,
  place: (card, messages) => {
    if (!card) return NO_PLACED_CHAT_CARDS;
    const userMessageIds = messages
      .filter((message) => message.sender === USER_SENDER)
      .map((message) => message.id);
    return [{ id: "draft", afterUserMessageId: userMessageIds[card.afterUserTurn - 1] ?? null }];
  },
  render: (card, _cardId, { plugin, chat }) =>
    card && <AgentDraftChatCard card={card} plugin={plugin} chat={chat} />,
});
