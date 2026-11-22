import { mockTFile } from "@/__tests__/mockObsidian";
import RelevantNotesView from "@/components/RelevantNotesView";
import { RELEVANT_NOTES_VIEWTYPE } from "@/constants";
import { act, fireEvent, within } from "@testing-library/react";
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
  return { view, onAddToChat };
}

describe("RelevantNotesView", () => {
  describe("RelevantNotesView", () => {
    describe("getViewType()", () => {
      it("reports the Copilot Relevant Notes view type", () => {
        expect(makeView().view.getViewType()).toBe(RELEVANT_NOTES_VIEWTYPE);
      });
    });

    describe("getDisplayText()", () => {
      it("names the tab Copilot Relevant Notes", () => {
        expect(makeView().view.getDisplayText()).toBe("Copilot Relevant Notes");
      });
    });

    describe("getIcon()", () => {
      it("shows the files icon", () => {
        expect(makeView().view.getIcon()).toBe("files");
      });
    });

    describe("onOpen()", () => {
      it("renders the relevant notes list, which adds a note to the chat through the callback the view was given", async () => {
        const { view, onAddToChat } = makeView();

        await act(() => view.onOpen());
        fireEvent.click(
          await within(view.containerEl).findByRole("button", { name: "Add idea to chat" })
        );

        expect(onAddToChat).toHaveBeenCalledWith(mockNote);
      });
    });

    describe("onClose()", () => {
      it("removes the relevant notes list", async () => {
        const { view } = makeView();
        await act(() => view.onOpen());

        await act(() => view.onClose());

        expect(
          within(view.containerEl).queryByRole("button", { name: "Add idea to chat" })
        ).toBeNull();
      });
    });
  });
});
