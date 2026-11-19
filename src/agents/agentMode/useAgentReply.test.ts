import type { AgentChatMessage } from "@/agentMode/session/types";
import { formatAgentReply } from "@/agents/agentReply";
import { useAgentReply } from "@/agents/agentMode/useAgentReply";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { act, renderHook } from "@testing-library/react";

jest.mock("@/entitlement");

const MARKER = { agent: "maya", name: "Maya", mention: "mention-1" };
const RELAY: AgentChatMessage = {
  id: "relay",
  sender: USER_SENDER,
  message: formatAgentReply({ ...MARKER, reply: "I disagree.", denied: [], changed: [] }),
  timestamp: null,
  isVisible: true,
};

describe("useAgentReply", () => {
  describe("useAgentReply()", () => {
    afterEach(async () => {
      await setCustomAgentsAccess("free");
    });

    it("reads a relayed reply from the message that carries it while custom agents are available (https://github.com/Brevilabs/obsidian-copilot-private/issues/944)", async () => {
      await setCustomAgentsAccess("team");

      const { result } = renderHook(() => useAgentReply(RELAY));

      expect(result.current).toEqual({ marker: MARKER, reply: "I disagree." });
    });

    it("reads nothing from an agent's own reply that quotes the marker", async () => {
      await setCustomAgentsAccess("team");

      const { result } = renderHook(() => useAgentReply({ ...RELAY, sender: AI_SENDER }));

      expect(result.current).toBeNull();
    });

    it("reads nothing while custom agents are hidden, and the reply once the license grants them (https://github.com/Brevilabs/obsidian-copilot-private/issues/944)", async () => {
      await setCustomAgentsAccess("free");
      const { result } = renderHook(() => useAgentReply(RELAY));
      expect(result.current).toBeNull();

      await act(async () => {
        await setCustomAgentsAccess("team");
      });

      expect(result.current?.reply).toBe("I disagree.");
    });
  });
});
