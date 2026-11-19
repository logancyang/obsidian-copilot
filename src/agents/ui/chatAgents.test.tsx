import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import {
  ChatAgentsContext,
  useChatAgents,
  useChatAgentsValue,
  useMentionableAgents,
  type ChatAgents,
} from "@/agents/ui/chatAgents";
import { fakeAgentStore } from "@/agents/ui/testing/fakeAgentStore";
import { COCO, LEO, MAYA, THREE_AGENTS } from "@/agents/ui/testing/rosterFixtures";
import { resetSettings } from "@/settings/model";
import { renderHook } from "@testing-library/react";
import React from "react";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/947";

function inChat(value: ChatAgents) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ChatAgentsContext.Provider value={value}>{children}</ChatAgentsContext.Provider>;
  };
}

describe("chatAgents", () => {
  beforeEach(() => resetSettings());

  describe("useChatAgentsValue()", () => {
    it("carries every agent in the vault and the chat's own agent", async () => {
      await setCustomAgentsAccess("team");
      const { store } = fakeAgentStore(THREE_AGENTS);

      const { result } = renderHook(() => useChatAgentsValue(store, "coco"));

      expect(result.current).toEqual({ agents: THREE_AGENTS, self: "coco" });
    });

    it("carries how the chat opens an asked agent's conversation, for its cards and its running agents list (https://github.com/Brevilabs/obsidian-copilot-private/issues/948)", async () => {
      await setCustomAgentsAccess("team");
      const { store } = fakeAgentStore(THREE_AGENTS);
      const openRun = jest.fn();

      const { result } = renderHook(() => useChatAgentsValue(store, "coco", { openRun }));

      expect(result.current.openRun).toBe(openRun);
    });

    it("carries which agents can't run on this device and how to open an agent's profile, for the @ menu (https://github.com/Brevilabs/obsidian-copilot-private/issues/962)", async () => {
      await setCustomAgentsAccess("team");
      const { store } = fakeAgentStore(THREE_AGENTS);
      const needsSetup = new Set(["leo"]);
      const openProfile = jest.fn();

      const { result } = renderHook(() =>
        useChatAgentsValue(store, null, { needsSetup, openProfile })
      );

      expect(result.current.needsSetup).toBe(needsSetup);
      expect(result.current.openProfile).toBe(openProfile);
    });

    it(`carries no agents while the stored license token awaits verification, so the chat shows none of them yet (${ISSUE})`, async () => {
      await setCustomAgentsAccess("unverified");
      const { store } = fakeAgentStore(THREE_AGENTS);

      const { result } = renderHook(() => useChatAgentsValue(store, null));

      expect(result.current.agents).toEqual([]);
    });
  });

  describe("useChatAgents()", () => {
    it("lists every agent, the chat's own agent included", () => {
      const { result } = renderHook(() => useChatAgents(), {
        wrapper: inChat({ agents: THREE_AGENTS, self: "coco" }),
      });

      expect(result.current).toEqual(THREE_AGENTS);
    });

    it("lists no agents outside an agent chat view", () => {
      const { result } = renderHook(() => useChatAgents());

      expect(result.current).toEqual([]);
    });
  });

  describe("useMentionableAgents()", () => {
    it(`leaves the chat's own agent out, since an agent can't mention itself (${ISSUE})`, async () => {
      await setCustomAgentsAccess("team");

      const { result } = renderHook(() => useMentionableAgents(), {
        wrapper: inChat({ agents: THREE_AGENTS, self: "coco" }),
      });

      expect(result.current).toEqual([MAYA, LEO]);
    });

    it(`lists every agent in a Copilot chat, which has no agent of its own (${ISSUE})`, async () => {
      await setCustomAgentsAccess("team");

      const { result } = renderHook(() => useMentionableAgents(), {
        wrapper: inChat({ agents: THREE_AGENTS, self: null }),
      });

      expect(result.current).toEqual([COCO, MAYA, LEO]);
    });

    it(`offers no agent to mention when the chat lists agents but the license doesn't include custom agents (https://github.com/Brevilabs/obsidian-copilot-private/issues/950)`, async () => {
      await setCustomAgentsAccess("plus-without-custom-agents");

      const { result } = renderHook(() => useMentionableAgents(), {
        wrapper: inChat({ agents: THREE_AGENTS, self: null }),
      });

      expect(result.current).toEqual([]);
    });
  });
});
