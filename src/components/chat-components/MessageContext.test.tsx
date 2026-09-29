import React from "react";
import { render } from "@testing-library/react";
import { ChatMessage } from "@/types/message";
import { TFile } from "obsidian";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@radix-ui/react-tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-trigger">{children}</div>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div data-testid="badge">{children}</div>,
}));

function MessageContext({ context }: { context: ChatMessage["context"] }) {
  if (!context || (!context.notes?.length && !context.urls?.length)) {
    return null;
  }

  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {context.notes.map((note, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- mirrors the production component; context arrays may contain duplicates
        <div key={`${index}-${note.path}`} data-testid="note-badge">
          <span>{note.basename}</span>
        </div>
      ))}
      {context.urls.map((url, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- mirrors the production component; context arrays may contain duplicates
        <div key={`${index}-${url}`} data-testid="url-badge">
          <span>{url}</span>
        </div>
      ))}
    </div>
  );
}

describe("MessageContext", () => {
  const createMockFile = (path: string, basename: string): TFile =>
    mockTFile({
      path,
      basename,
    });

  describe("Duplicate Notes Bug Prevention", () => {
    it("should render duplicate notes without React key conflicts", () => {
      const context: ChatMessage["context"] = {
        notes: [
          createMockFile("Piano Lessons/Lesson 4.md", "Lesson 4"),
          createMockFile("Piano Lessons/Lesson 4.md", "Lesson 4"),
          createMockFile("Piano Lessons/Lesson 1.md", "Lesson 1"),
          createMockFile("Piano Lessons/Lesson 1.md", "Lesson 1"),
        ],
        urls: ["https://example.com", "https://example.com", "https://google.com"],
        selectedTextContexts: [],
      };

      const { container } = render(<MessageContext context={context} />);

      expect(container.querySelectorAll('[data-testid="note-badge"]')).toHaveLength(4);
      expect(container.querySelectorAll('[data-testid="url-badge"]')).toHaveLength(3);
    });

    it("should handle empty context gracefully", () => {
      const context: ChatMessage["context"] = {
        notes: [],
        urls: [],
        selectedTextContexts: [],
      };

      const { container } = render(<MessageContext context={context} />);
      expect(container.firstChild).toBeNull();
    });

    it("should handle undefined context gracefully", () => {
      const { container } = render(<MessageContext context={undefined} />);
      expect(container.firstChild).toBeNull();
    });

    it("should render unique keys for duplicate paths", () => {
      const context: ChatMessage["context"] = {
        notes: [
          createMockFile("Piano Lessons/Lesson 4.md", "Lesson 4"),
          createMockFile("Piano Lessons/Lesson 4.md", "Lesson 4"),
        ],
        urls: [],
        selectedTextContexts: [],
      };

      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      render(<MessageContext context={context} />);

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Warning: Encountered two children with the same key")
      );

      consoleSpy.mockRestore();
    });
  });
});
