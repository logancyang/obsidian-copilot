/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Mock exports must preserve production hook names. */
import { RelevantNoteRow } from "@/components/chat-components/ui/RelevantNoteRow";
import type { RelevantNoteEntry } from "@/search/findRelevantNotes";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockApp = {
  vault: {
    getAbstractFileByPath: jest.fn(() => null),
    cachedRead: jest.fn().mockResolvedValue(""),
  },
};

jest.mock("@/context", () => ({
  useApp: () => mockApp,
}));

jest.mock("@/hooks/useNoteDrag", () => ({
  useNoteDrag: () => jest.fn(),
}));

function entry(overrides: Partial<RelevantNoteEntry["metadata"]> = {}): RelevantNoteEntry {
  return {
    note: { path: "Design principles.md", title: "Design principles" },
    metadata: { score: 0.86, hasOutgoingLinks: false, hasBacklinks: false, ...overrides },
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof RelevantNoteRow>> = {}) {
  return render(
    <RelevantNoteRow
      note={entry()}
      exiting={false}
      entering={false}
      animated
      rowRef={() => undefined}
      onAddToChat={() => undefined}
      onNavigateToNote={() => undefined}
      {...props}
    />
  );
}

describe("RelevantNoteRow", () => {
  describe("RelevantNoteRow()", () => {
    it("names the note and states how strongly it matches", () => {
      renderRow();

      expect(screen.getByText("Design principles")).toBeTruthy();
      expect(screen.getByText("86%")).toBeTruthy();
    });

    it("marks a note that is linked in either direction", () => {
      renderRow({ note: entry({ hasOutgoingLinks: true, hasBacklinks: true }) });

      expect(screen.getByTitle("Outgoing link")).toBeTruthy();
      expect(screen.getByTitle("Backlink")).toBeTruthy();
    });

    it("opens the note when its title is clicked", () => {
      const onNavigateToNote = jest.fn();
      renderRow({ onNavigateToNote });

      fireEvent.click(screen.getByText("Design principles"));

      expect(onNavigateToNote).toHaveBeenCalledTimes(1);
    });

    it("adds the note to the chat from its row action", () => {
      const onAddToChat = jest.fn();
      renderRow({ onAddToChat });

      fireEvent.click(screen.getByTitle("Add to Chat"));

      expect(onAddToChat).toHaveBeenCalledTimes(1);
    });

    it("registers its element so a rank change can be slid into place (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const rowRef = jest.fn();
      renderRow({ rowRef });

      expect(rowRef).toHaveBeenCalledWith(expect.any(HTMLElement));
    });

    it("plays an arrival for a note joining the results (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const rowRef = jest.fn();
      renderRow({ entering: true, rowRef });

      expect(rowRef.mock.calls[0][0].className).toContain("tw-animate-in");
    });

    it("holds a departing note behind while its removal plays (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const rowRef = jest.fn();
      renderRow({ exiting: true, rowRef });

      expect(rowRef.mock.calls[0][0].className).toContain("tw-pointer-events-none");
      expect(rowRef.mock.calls[0][0].className).toContain("tw-transition-opacity");
    });

    it("removes a departing note without a fade when the reader has asked for reduced motion (https://github.com/Brevilabs/obsidian-copilot-private/issues/362)", () => {
      const rowRef = jest.fn();
      renderRow({ exiting: true, animated: false, rowRef });

      expect(rowRef.mock.calls[0][0].className).not.toContain("tw-transition-opacity");
    });
  });
});
