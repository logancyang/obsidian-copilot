import type { CustomAgent } from "@/agents/CustomAgentStore";
import { useAgentChatIcon, useAgentRecentChats } from "@/agents/ui/useAgentRecentChats";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { render, renderHook, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/588";

function agent(slug: string, name: string): CustomAgent {
  return { slug, name, title: `${name}'s job`, faceSrc: `face:${slug}` } as CustomAgent;
}

function chat(id: string, agentSlug?: string): ChatHistoryItem {
  return { id, title: id, createdAt: new Date(0), lastAccessedAt: new Date(0), agent: agentSlug };
}

const COCO = agent("coco", "Coco");
const NORA = agent("nora", "Nora");
const CHATS = [chat("plan", "coco"), chat("notes"), chat("taxes", "gone")];

function renderIcon(Icon: React.ComponentType<{ className?: string }> | undefined) {
  if (!Icon) throw new Error("No icon");
  return render(<Icon className="tw-size-4" />).container.querySelector("img");
}

describe("useAgentRecentChats", () => {
  describe("useAgentRecentChats()", () => {
    it(`lists every chat with Copilot selected, showing each agent chat's face and the usual icon for the rest (${ISSUE})`, () => {
      const { result } = renderHook(() => useAgentRecentChats(CHATS, [COCO, NORA], null));

      expect(result.current.items).toBe(CHATS);
      expect(renderIcon(result.current.getIcon?.(CHATS[0]))?.getAttribute("src")).toBe("face:coco");
      expect(result.current.getIcon?.(CHATS[1])).toBeUndefined();
      expect(result.current.getIcon?.(CHATS[2])).toBeUndefined();
      expect(result.current.searchPlaceholder).toBeUndefined();
      expect(result.current.emptyState).toBeUndefined();
    });

    it(`lists only the selected agent's chats and names it in the search (${ISSUE})`, () => {
      const { result } = renderHook(() => useAgentRecentChats(CHATS, [COCO, NORA], COCO));

      expect(result.current.items).toEqual([CHATS[0]]);
      expect(result.current.searchPlaceholder).toBe("Search chats with Coco...");
    });

    it(`explains that an agent has no chats yet and that the first message starts one (${ISSUE})`, () => {
      const { result } = renderHook(() => useAgentRecentChats(CHATS, [COCO, NORA], NORA));
      expect(result.current.items).toEqual([]);

      render(<>{result.current.emptyState}</>);

      expect(screen.getByText("No chats with Nora yet.")).not.toBeNull();
      expect(screen.getByText("Your first message starts one.")).not.toBeNull();
    });

    it(`leaves the list and its icons as they are while no agents are listed (${ISSUE})`, () => {
      const { result } = renderHook(() => useAgentRecentChats(CHATS, [], null));

      expect(result.current.items).toBe(CHATS);
      expect(result.current.getIcon).toBeUndefined();
    });
  });

  describe("useAgentChatIcon()", () => {
    const NAVIGATOR_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/938";

    it(`gives an agent chat its agent's face and leaves a Copilot chat or a chat whose agent is gone to the usual icon (${NAVIGATOR_ISSUE})`, () => {
      const { result } = renderHook(() => useAgentChatIcon([COCO, NORA]));

      expect(renderIcon(result.current?.(CHATS[0]))?.getAttribute("src")).toBe("face:coco");
      expect(result.current?.(CHATS[1])).toBeUndefined();
      expect(result.current?.(CHATS[2])).toBeUndefined();
    });

    it(`draws the face at 16px even where the list draws its icons smaller, as the Navigator does (${NAVIGATOR_ISSUE})`, () => {
      const { result } = renderHook(() => useAgentChatIcon([COCO]));
      const Face = result.current?.(CHATS[0]);
      if (!Face) throw new Error("No icon");

      const face = render(<Face className="tw-size-3.5" />).container.querySelector("img");

      expect(face?.className).toContain("tw-size-4");
      expect(face?.className).not.toContain("tw-size-3.5");
    });

    it("gives no icons while no agents are listed", () => {
      const { result } = renderHook(() => useAgentChatIcon([]));

      expect(result.current).toBeUndefined();
    });
  });
});
