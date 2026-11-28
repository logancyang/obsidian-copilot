import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { CONNECTOR_CARDS, type ConnectorCard } from "@/connectors/agentMode/connectorCards";
import { AI_SENDER, USER_SENDER } from "@/constants";
import type CopilotPlugin from "@/main";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { connectorCardSlot } from "./connectorCardSlot";

jest.mock("@/connectors/ui/ConnectorChatCard", () => ({
  ConnectorChatCard: ({ serviceId, onDismiss }: { serviceId: string; onDismiss: () => void }) => (
    <button type="button" onClick={onDismiss}>
      Connect card {serviceId}
    </button>
  ),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/860";

function message(id: string, sender: string): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

const TRANSCRIPT = [
  message("u1", USER_SENDER),
  message("a1", AI_SENDER),
  message("u2", USER_SENDER),
];

function card(serviceId: string, overrides: Partial<ConnectorCard> = {}): ConnectorCard {
  return { serviceId, afterUserTurn: 1, dismissed: false, reported: null, ...overrides };
}

describe("connectorCardSlot", () => {
  describe("place()", () => {
    it(`${ISSUE} places each card after the user message of the turn that asked for it, counted by turn so a Reload that gives messages new IDs keeps it there`, () => {
      expect(
        connectorCardSlot.place([card("notion"), card("linear", { afterUserTurn: 2 })], TRANSCRIPT)
      ).toEqual([
        { id: "notion", afterUserMessageId: "u1" },
        { id: "linear", afterUserMessageId: "u2" },
      ]);
    });

    it("places a card at the end when its turn is no longer in the transcript", () => {
      expect(connectorCardSlot.place([card("notion", { afterUserTurn: 5 })], TRANSCRIPT)).toEqual([
        { id: "notion", afterUserMessageId: null },
      ]);
    });

    it("places nothing for dismissed cards", () => {
      expect(connectorCardSlot.place([card("notion", { dismissed: true })], TRANSCRIPT)).toEqual(
        []
      );
    });
  });

  describe("render()", () => {
    it(`${ISSUE} draws the service's card and dismisses it through the chat`, () => {
      const chat = fakeChat();
      chat.updateChatState(CONNECTOR_CARDS, () => [card("notion")]);
      const plugin = { connectionManager: {} } as unknown as CopilotPlugin;

      render(<>{connectorCardSlot.render([card("notion")], "notion", { plugin, chat })}</>);
      fireEvent.click(screen.getByRole("button", { name: "Connect card notion" }));

      expect(chat.readChatState(CONNECTOR_CARDS)).toEqual([card("notion", { dismissed: true })]);
    });

    it("draws nothing where connectors aren't available", () => {
      const plugin = {} as CopilotPlugin;

      expect(
        connectorCardSlot.render([card("notion")], "notion", { plugin, chat: fakeChat() })
      ).toBeNull();
    });
  });
});
