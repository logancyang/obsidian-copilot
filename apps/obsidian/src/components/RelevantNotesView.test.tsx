import { mockTFile } from "@/__tests__/mockObsidian";
import RelevantNotesView from "@/components/RelevantNotesView";
import { RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import { act, fireEvent, screen } from "@testing-library/react";
import type { TFile, WorkspaceLeaf } from "obsidian";

const mockNote = mockTFile({ path: "notes/idea.md" });
jest.mock("@/components/chat-components/RelevantNotes", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    RelevantNotes: ({ onAddToChat }: { onAddToChat: (note: TFile) => void }) =>
      React.createElement(
        "button",
        { type: "button", onClick: () => onAddToChat(mockNote) },
        "Add idea to chat"
      ),
  };
});
jest.mock("@/utils/registerActiveLeafChangeBridge", () => ({
  registerActiveLeafChangeBridge: jest.fn(),
}));

function makeView() {
  const onAddToChat = jest.fn();
  const leaf = { app: {} } as unknown as WorkspaceLeaf;
  const view = new RelevantNotesView(leaf, onAddToChat);
  document.body.appendChild(view.containerEl);
  return { view, onAddToChat };
}

describe("RelevantNotesView", () => {
  describe("RelevantNotesView", () => {
    it("identifies itself as the Copilot Relevant Notes view", () => {
      const { view } = makeView();

      expect(view.getViewType()).toBe(RELEVANT_NOTES_VIEWTYPE);
      expect(view.getDisplayText()).toBe("Copilot Relevant Notes");
      expect(view.getIcon()).toBe("files");
    });

    it("adds a relevant note to the chat through the callback it was given, and removes the list when it closes", async () => {
      const { view, onAddToChat } = makeView();

      await act(() => view.onOpen());
      fireEvent.click(await screen.findByRole("button", { name: "Add idea to chat" }));

      expect(onAddToChat).toHaveBeenCalledWith(mockNote);

      await act(() => view.onClose());
      expect(screen.queryByRole("button", { name: "Add idea to chat" })).toBeNull();
    });
  });
});
