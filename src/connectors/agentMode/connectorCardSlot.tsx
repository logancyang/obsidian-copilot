import { defineChatCardSlot, NO_PLACED_CHAT_CARDS } from "@/agentMode/ui/chatCards";
import {
  CONNECTOR_CARDS,
  dismissConnectorCard,
  type ServiceConnectorCard,
} from "@/connectors/agentMode/connectorCards";
import { ConnectorChatCard } from "@/connectors/ui/ConnectorChatCard";
import { USER_SENDER } from "@/constants";
import React from "react";

export const connectorCardSlot = defineChatCardSlot({
  key: CONNECTOR_CARDS,
  place: (cards, messages) => {
    const shown = cards.filter(
      (card): card is ServiceConnectorCard => "serviceId" in card && !card.dismissed
    );
    if (shown.length === 0) return NO_PLACED_CHAT_CARDS;
    const userMessageIds = messages
      .filter((message) => message.sender === USER_SENDER)
      .map((message) => message.id);
    return shown.map((card) => ({
      id: card.serviceId,
      afterUserMessageId: userMessageIds[card.afterUserTurn - 1] ?? null,
    }));
  },
  render: (_cards, serviceId, { plugin, chat }) =>
    plugin.connectionManager ? (
      <ConnectorChatCard
        serviceId={serviceId}
        manager={plugin.connectionManager}
        onDismiss={() =>
          chat.updateChatState(CONNECTOR_CARDS, (cards) => dismissConnectorCard(cards, serviceId))
        }
      />
    ) : null,
});
