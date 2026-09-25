import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextSelectedTextBadge } from "@/components/chat-components/ContextBadges";
import type { SelectedTextContext } from "@/types/message";

jest.mock("@/components/TruncatedText", () => ({
  TruncatedText: ({
    children,
    tooltipContent,
  }: {
    children: React.ReactNode;
    tooltipContent: React.ReactNode;
  }) => (
    <>
      <span data-testid="label">{children}</span>
      <div role="tooltip">{tooltipContent}</div>
    </>
  ),
}));

const note: SelectedTextContext = {
  id: "note-excerpt",
  sourceType: "note",
  content: "",
  noteTitle: "Research",
  notePath: "Projects/Research.md",
  startLine: 2,
  endLine: 3,
};
const web: SelectedTextContext = {
  id: "web-excerpt",
  sourceType: "web",
  content: "",
  title: "Interview guide",
  url: "https://example.com/interviews",
};

describe("ContextBadges", () => {
  describe("ContextSelectedTextBadge()", () => {
    it.each([
      { source: note, content: "Interview findings", label: "Interview findings" },
      { source: note, content: "a".repeat(79) + "😀👩‍💻é", label: "a".repeat(79) + "😀👩‍💻é" },
      { source: web, content: "Interview findings", label: "Interview findings" },
      { source: note, content: "  First line\n\nsecond\tline  ", label: "First line second line" },
      { source: web, content: "  First line\n\nsecond\tline  ", label: "First line second line" },
      {
        source: note,
        content: "The selected passage starts here. ".repeat(4),
        label: "The selected passage starts here. ".repeat(4).trim(),
      },
      {
        source: web,
        content: "The selected passage starts here. ".repeat(4),
        label: "The selected passage starts here. ".repeat(4).trim(),
      },
    ])(
      "previews $source.sourceType excerpt '$label' instead of its source title - https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
      ({ source, content, label }) => {
        render(<ContextSelectedTextBadge selectedText={{ ...source, content }} />);
        expect(screen.getByTestId("label").textContent).toBe(label);
        expect(screen.getByText(source.sourceType === "note" ? "L2-3" : "Selection")).toBeTruthy();
      }
    );

    it.each([note, web])(
      "keeps the full $sourceType excerpt and source in its tooltip - https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
      (source) => {
        const content = "First paragraph.\n\n" + "Additional interview findings. ".repeat(5);
        render(<ContextSelectedTextBadge selectedText={{ ...source, content }} />);
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip.textContent).toContain(content);
        expect(tooltip.textContent).toContain(
          source.sourceType === "note" ? source.notePath : source.url
        );
      }
    );

    it("shows a Reading view excerpt and note path without a false line number (https://github.com/Brevilabs/obsidian-copilot-private/issues/597)", () => {
      render(
        <ContextSelectedTextBadge
          selectedText={{
            id: "reading-excerpt",
            sourceType: "note",
            content: "Rendered note passage",
            noteTitle: "Research",
            notePath: "Projects/Research.md",
            startLine: 0,
            endLine: 0,
          }}
        />
      );
      expect(screen.getByTestId("label").textContent).toBe("Rendered note passage");
      expect(screen.getByText("Selection")).toBeTruthy();
      expect(screen.getByRole("tooltip").textContent).toContain("Projects/Research.md");
      expect(screen.getByRole("tooltip").textContent).not.toMatch(/L\d/);
    });

    it.each([note, web])("removes a $sourceType selection from its excerpt badge", (source) => {
      const onRemove = jest.fn();
      render(
        <ContextSelectedTextBadge
          selectedText={{ ...source, content: "Selected passage" }}
          onRemove={onRemove}
        />
      );
      fireEvent.keyDown(screen.getByTestId("label").parentElement!, { key: "Enter" });
      expect(onRemove).toHaveBeenCalledTimes(1);
    });
  });
});
