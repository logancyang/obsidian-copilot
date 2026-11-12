import { AGENT_MEMORY, type AgentMemoryChatState } from "@/agents/agentMode/agentMemoryChat";
import { fakeChat } from "@/agentMode/session/testing/fakeChat";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";
import type CopilotPlugin from "@/main";
import { openVaultPath } from "@/utils/openVaultPath";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { agentMemoryCardSlot } from "./agentMemoryCardSlot";

jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));

function message(id: string, sender: string): AgentChatMessage {
  return { id, sender, message: id, timestamp: null, isVisible: true };
}

const FLUSHED: AgentMemoryChatState = {
  ...AGENT_MEMORY.initial,
  notice: {
    kind: "flush",
    agentName: "Jennifer",
    path: "copilot/agents/jennifer/memory/2026-09-17.md",
    afterUserTurn: 2,
  },
};

const TWO_TURNS = [
  message("u1", USER_SENDER),
  message("a1", AI_SENDER),
  message("u2", USER_SENDER),
  message("a2", AI_SENDER),
];

describe("agentMemoryCardSlot", () => {
  describe("place()", () => {
    it("places the trust line after the turn it was shown under", () => {
      expect(agentMemoryCardSlot.place(FLUSHED, TWO_TURNS)).toEqual([
        { id: "flush", afterUserMessageId: "u2" },
      ]);
    });

    it("drops the line once the user sends another message", () => {
      expect(
        agentMemoryCardSlot.place(FLUSHED, [...TWO_TURNS, message("u3", USER_SENDER)])
      ).toEqual([]);
    });

    it("places nothing while there is no line to show", () => {
      expect(agentMemoryCardSlot.place(AGENT_MEMORY.initial, TWO_TURNS)).toEqual([]);
    });
  });

  describe("render()", () => {
    it("names what the agent wrote and opens that file in a new tab", () => {
      const plugin = { app: { name: "app" } } as unknown as CopilotPlugin;

      render(<>{agentMemoryCardSlot.render(FLUSHED, "flush", { plugin, chat: fakeChat() })}</>);
      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      expect(screen.getByText("Jennifer added to today's notes")).toBeTruthy();
      expect(openVaultPath).toHaveBeenCalledWith(
        plugin.app,
        "copilot/agents/jennifer/memory/2026-09-17.md",
        { pane: "tab" }
      );
    });

    it("draws nothing while there is no line to show", () => {
      const plugin = {} as CopilotPlugin;

      expect(
        agentMemoryCardSlot.render(AGENT_MEMORY.initial, "flush", { plugin, chat: fakeChat() })
      ).toBeNull();
    });
  });
});
