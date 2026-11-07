import { defineChatCardSlot, NO_PLACED_CHAT_CARDS } from "@/agentMode/ui/chatCards";
import {
  CONNECTOR_CARDS,
  connectorCardKey,
  dismissConnectorCard,
  markConnectorCardAdded,
} from "@/connectors/agentMode/connectorCards";
import { ConnectorChatCard } from "@/connectors/ui/ConnectorChatCard";
import { CustomConnectorChatCard } from "@/connectors/ui/CustomConnectorChatCard";
import { USER_SENDER } from "@/constants";
import React from "react";

export const connectorCardSlot = defineChatCardSlot({
  key: CONNECTOR_CARDS,
  place: (cards, messages) => {
    const shown = cards.filter((card) => !card.dismissed);
    if (shown.length === 0) return NO_PLACED_CHAT_CARDS;
    const userMessageIds = messages
      .filter((message) => message.sender === USER_SENDER)
      .map((message) => message.id);
    return shown.map((card) => ({
      id: connectorCardKey(card),
      afterUserMessageId: userMessageIds[card.afterUserTurn - 1] ?? null,
    }));
  },
  render: (cards, key, { plugin, chat }) => {
    const card = cards.find((candidate) => connectorCardKey(candidate) === key);
    const onDismiss = () =>
      chat.updateChatState(CONNECTOR_CARDS, (current) => dismissConnectorCard(current, key));
    if (!card) return null;
    if ("serviceId" in card) {
      return plugin.connectionManager ? (
        <ConnectorChatCard
          serviceId={card.serviceId}
          manager={plugin.connectionManager}
          onDismiss={onDismiss}
        />
      ) : null;
    }
    return plugin.customConnectors ? (
      <CustomConnectorChatCard
        card={card}
        customConnectors={plugin.customConnectors}
        onDismiss={onDismiss}
        onAdded={(connectorId) =>
          chat.updateChatState(CONNECTOR_CARDS, (current) =>
            markConnectorCardAdded(current, key, connectorId)
          )
        }
      />
    ) : null;
  },
});
