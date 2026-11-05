import { AgentHomeShelf } from "@/agentMode/ui/AgentHomeShelf";
import { useRelevantNotesShelfSection } from "@/agentMode/ui/hooks/useRelevantNotesShelfSection";
import type CopilotPlugin from "@/main";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import React from "react";

const packingList = new (TFile as unknown as new (path: string) => TFile)("Trip/Packing list.md");
jest.mock("@/components/chat-components/RelevantNotes", () => ({
  RelevantNotes: ({ onAddToChat }: { onAddToChat: (note: TFile) => void }) => (
    <button type="button" onClick={() => onAddToChat(packingList)}>
      Add Packing list
    </button>
  ),
}));

function appWithPane(shown: boolean | null): App {
  const leaves = shown === null ? [] : [{ view: { containerEl: { isShown: () => shown } } }];
  return {
    workspace: {
      getLeavesOfType: () => leaves as unknown as WorkspaceLeaf[],
      on: jest.fn(),
      offref: jest.fn(),
    },
  } as unknown as App;
}

function pluginFor(app: App) {
  return {
    app,
    activateRelevantNotesView: jest.fn().mockResolvedValue(null),
    addNoteToActiveChat: jest.fn().mockResolvedValue(undefined),
  } as unknown as CopilotPlugin & {
    activateRelevantNotesView: jest.Mock;
    addNoteToActiveChat: jest.Mock;
  };
}

describe("useRelevantNotesShelfSection", () => {
  describe("useRelevantNotesShelfSection()", () => {
    it.each([
      ["no Relevant Notes pane exists", null],
      ["the Relevant Notes pane is hidden", false],
    ])(
      "offers a Relevant Notes shelf tab for the Agent home and project home when %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/845)",
      (_case, shown) => {
        const app = appWithPane(shown);
        const plugin = pluginFor(app);
        const { result } = renderHook(() => useRelevantNotesShelfSection(app, plugin));

        expect(result.current).toMatchObject({ id: "relevant-notes", title: "Relevant Notes" });
        render(<AgentHomeShelf sections={[result.current!]} />);
        fireEvent.click(screen.getByRole("button", { name: "Add Packing list" }));
        fireEvent.click(screen.getByRole("button", { name: "Open in separate pane" }));
        expect(plugin.addNoteToActiveChat).toHaveBeenCalledWith(packingList);
        expect(plugin.activateRelevantNotesView).toHaveBeenCalledTimes(1);
      }
    );

    it("offers no shelf tab while a Relevant Notes pane is visible (https://github.com/Brevilabs/obsidian-copilot-private/issues/845)", () => {
      const app = appWithPane(true);
      const { result } = renderHook(() => useRelevantNotesShelfSection(app, pluginFor(app)));

      expect(result.current).toBeNull();
    });

    it("keeps the same section across renders so the shelf does not rebuild its tabs", () => {
      const app = appWithPane(null);
      const plugin = pluginFor(app);
      const { result, rerender } = renderHook(() => useRelevantNotesShelfSection(app, plugin));
      const first = result.current;

      rerender();

      expect(result.current).toBe(first);
    });
  });
});
