import { useMemorySaveTrail } from "@/agents/agentMode/useMemorySaveTrail";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { setCustomAgentsLaunched } from "@/agents/testing/customAgentsLaunched";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { act, renderHook } from "@testing-library/react";
import type { App } from "obsidian";

jest.mock("@/entitlement");

const SAVE = {
  agentName: "Coco",
  memoryPath: "copilot/agents/coco/MEMORY.md",
  rule: "Launch videos lead with user value.",
};

const REPLY: AgentChatMessage = {
  id: "reply",
  sender: "AI",
  message: "Got it.",
  timestamp: null,
  isVisible: true,
  memorySaves: [SAVE],
};

describe("useMemorySaveTrail", () => {
  describe("useMemorySaveTrail()", () => {
    afterEach(async () => {
      await setCustomAgentsAccess("free");
    });

    it("gives a reply's saves while custom agents are available", async () => {
      await setCustomAgentsAccess("team");

      const { result } = renderHook(() => useMemorySaveTrail(REPLY, {} as App));

      expect(result.current).toEqual({ saves: [SAVE], anchorId: null });
    });

    it("gives nothing while custom agents are hidden, and the saves once the license grants them (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", async () => {
      await setCustomAgentsAccess("free");
      const { result } = renderHook(() => useMemorySaveTrail(REPLY, {} as App));
      expect(result.current).toBeNull();

      await act(async () => {
        await setCustomAgentsAccess("team");
      });

      expect(result.current?.saves).toEqual([SAVE]);
    });
    it("gives a reply's saves while custom agents are locked, so an agent chat from before the license lapsed still shows what it remembered (https://github.com/Brevilabs/obsidian-copilot-private/issues/950)", async () => {
      setCustomAgentsLaunched(true);
      await setCustomAgentsAccess("free");

      const { result } = renderHook(() => useMemorySaveTrail(REPLY, {} as App));

      expect(result.current?.saves).toEqual([SAVE]);
    });
  });
});
