/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- Mock exports must preserve production hook names. */
import { RelevantNoteRow } from "@/components/chat-components/ui/RelevantNoteRow";
import type { RelevantNoteEntry } from "@/search/findRelevantNotes";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { fireEvent, render, screen } from "@testing-library/react";
import { TFile } from "obsidian";
import React from "react";

const mockApp = {
  vault: {
    getAbstractFileByPath: jest.fn<TFile | null, [string]>(() => null),
    cachedRead: jest.fn().mockResolvedValue(""),
  },
};

jest.mock("@/context", () => ({
  useApp: () => mockApp,
}));

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn(),
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
    it("renders the hover preview as Markdown with links relative to the previewed note", async () => {
      const file: unknown = Object.create(TFile.prototype);
      if (!(file instanceof TFile)) throw new Error("Expected a TFile fixture");
      Object.assign(file, {
        path: "Design principles.md",
      });
      mockApp.vault.getAbstractFileByPath.mockReturnValueOnce(file);
      mockApp.vault.cachedRead.mockResolvedValueOnce(
        "---\ntags: [design]\n---\n# Readable preview\n\n**Key idea**"
      );
      jest.mocked(renderMarkdown).mockImplementationOnce(async (_app, _text, target) => {
        const heading = target.doc.createElement("h1");
        heading.textContent = "Readable preview";
        target.appendChild(heading);
      });

      renderRow();
      fireEvent.mouseEnter(screen.getByText("Design principles"));

      const heading = await screen.findByRole("heading", { name: "Readable preview" });
      expect(heading.closest(".markdown-rendered")).not.toBeNull();
      expect(renderMarkdown).toHaveBeenCalledWith(
        mockApp,
        "# Readable preview\n\n**Key idea**",
        expect.any(HTMLElement),
        file.path,
        expect.anything()
      );
    });

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
