import type { CustomAgent } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess, verifyStoredToken } from "@/agents/testing/customAgentsAccess";
import { AgentProfileCover, useAgentProfileRoute } from "@/agents/ui/AgentProfileCover";
import { fakeAgentStore } from "@/agents/ui/testing/fakeAgentStore";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { resetSettings } from "@/settings/model";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";
const LOCKED_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";

function agent(slug: string, name: string): CustomAgent {
  return { slug, name, title: "", instruction: "", faceSrc: `face:${slug}` } as CustomAgent;
}

const COCO = agent("coco", "Coco");
const MAYA = agent("maya", "Maya");

describe("AgentProfileCover", () => {
  beforeEach(() => resetSettings());

  describe("AgentProfileCover()", () => {
    function Chat() {
      const [draft, setDraft] = React.useState("");
      return <input aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />;
    }

    it(`covers the chat with the profile and returns to the same chat, draft kept, on Back (${ISSUE})`, () => {
      const { rerender } = render(
        <AgentProfileCover profile={null}>
          <Chat />
        </AgentProfileCover>
      );
      const draft = screen.getByLabelText<HTMLInputElement>("Draft");
      fireEvent.change(draft, { target: { value: "Also add a hook" } });

      rerender(
        <AgentProfileCover profile={<div>Coco's profile</div>} header={<div>Coco's bar</div>}>
          <Chat />
        </AgentProfileCover>
      );
      expect(screen.getByText("Coco's profile")).not.toBeNull();
      expect(draft.closest(".tw-invisible")).not.toBeNull();
      expect(screen.getByText("Coco's bar").closest(".tw-invisible")).not.toBeNull();

      rerender(
        <AgentProfileCover profile={null}>
          <Chat />
        </AgentProfileCover>
      );
      expect(screen.queryByText("Coco's profile")).toBeNull();
      expect(screen.getByLabelText("Draft")).toBe(draft);
      expect(draft.value).toBe("Also add a hook");
      expect(draft.closest(".tw-invisible")).toBeNull();
    });
  });

  describe("useAgentProfileRoute()", () => {
    function useRoute(chatInputId: string, store = fakeAgentStore([COCO, MAYA]).store) {
      return useAgentProfileRoute(useCustomAgents(store), chatInputId);
    }

    it("opens an agent's profile over the chat it was opened from and closes it on Back", async () => {
      await setCustomAgentsAccess("team");
      const { result } = renderHook(() => useRoute("chat-1"));

      act(() => result.current.open("maya"));
      expect(result.current.agent).toBe(MAYA);

      act(() => result.current.close());
      expect(result.current.agent).toBeNull();
    });

    it(`goes back for good when the user switches to another chat (${ISSUE})`, async () => {
      await setCustomAgentsAccess("team");
      const { store } = fakeAgentStore([COCO]);
      const { result, rerender } = renderHook(({ id }) => useRoute(id, store), {
        initialProps: { id: "chat-1" },
      });
      act(() => result.current.open("coco"));

      rerender({ id: "chat-2" });
      expect(result.current.agent).toBeNull();
      rerender({ id: "chat-1" });

      expect(result.current.agent).toBeNull();
    });

    it(`goes back without an error when the agent's folder disappears while its profile is open (${ISSUE})`, async () => {
      await setCustomAgentsAccess("team");
      const { store, publish } = fakeAgentStore([COCO, MAYA]);
      const { result } = renderHook(() => useRoute("chat-1", store));
      act(() => result.current.open("coco"));

      publish([MAYA]);
      expect(result.current.agent).toBeNull();
      publish([COCO, MAYA]);

      expect(result.current.agent).toBeNull();
    });

    it(`stays open when the license stops carrying custom agents, so the profile shows locked (${LOCKED_ISSUE})`, async () => {
      await setCustomAgentsAccess("team");
      const { result } = renderHook(() => useRoute("chat-1"));
      act(() => result.current.open("coco"));

      await act(() => verifyStoredToken(false));

      expect(result.current.agent).toBe(COCO);
    });

    it(`opens no profile while the stored license token awaits verification (${ISSUE})`, async () => {
      await setCustomAgentsAccess("unverified");
      const { result } = renderHook(() => useRoute("chat-1"));

      act(() => result.current.open("coco"));

      expect(result.current.agent).toBeNull();
    });
  });
});
