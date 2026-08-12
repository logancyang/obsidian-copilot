import { RelevantNotesShelfPanel } from "@/agentMode/ui/RelevantNotesShelfPanel";
import { AppContext } from "@/context";
import { render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/agentMode/ui/homeShelfPrefs", () => ({
  dismissPopOutHint: jest.fn(),
  isPopOutHintDismissed: () => true,
}));

jest.mock("@/components/chat-components/RelevantNotes", () => ({
  RelevantNotes: ({ className }: { className?: string }) => (
    <div data-testid="relevant-notes" className={className} />
  ),
}));

describe("RelevantNotesShelfPanel", () => {
  describe("RelevantNotesShelfPanel()", () => {
    it("fills the Agent Home shelf and reserves vertical spacing for empty states", () => {
      // homeShelfPrefs is mocked, so the app is never dereferenced.
      const { container } = render(
        <AppContext.Provider value={{} as App}>
          <RelevantNotesShelfPanel onPopOut={jest.fn()} onAddToChat={jest.fn()} />
        </AppContext.Provider>
      );

      const panel = container.firstElementChild as HTMLElement;
      const relevantNotes = screen.getByTestId("relevant-notes");
      const content = relevantNotes.parentElement as HTMLElement;

      expect(panel.classList.contains("tw-flex-1")).toBe(true);
      expect(panel.classList.contains("tw-min-h-0")).toBe(true);
      expect(content.classList.contains("tw-flex")).toBe(true);
      expect(content.classList.contains("tw-flex-col")).toBe(true);
      expect(relevantNotes.className).toContain("[&>[data-relevant-notes-empty-state]]:tw-py-6");
    });
  });
});
