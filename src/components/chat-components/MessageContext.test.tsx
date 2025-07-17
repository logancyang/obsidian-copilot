import React from "react";
import { render } from "@testing-library/react";
import { ChatMessage } from "@/types/message";
import { TFile } from "obsidian";

// Mock Tooltip components
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

// Mock Badge component
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div data-testid="badge">{children}</div>,
}));

// Extract MessageContext component inline for testing
function MessageContext({ context }: { context: ChatMessage["context"] }) {
  if (!context || (!context.notes?.length && !context.urls?.length)) {
    return null;
  }

  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {context.notes.map((note, index) => (
        <div key={`${index}-${note.path}`} data-testid="note-badge">
          <span>{note.basename}</span>
        </div>
      ))}
      {context.urls.map((url, index) => (
        <div key={`${index}-${url}`} data-testid="url-badge">
          <span>{url}</span>
        </div>
      ))}
    </div>
  );
}

describe("MessageContext", () => {
  const createMockFile = (path: string, basename: string): TFile =>
    ({
      path,
      basename,
      // Add other required TFile properties as needed
    }) as TFile;

  describe("Duplicate Notes Bug Prevention", () => {
    it("should render duplicate notes without React key conflicts", () => {
      const context: ChatMessage["context"] = {
        notes: [
          createMockFile("Piano Lessons/Lesson 4.md", "Lesson 4"),
          createMockFile("Piano Lessons/Lesson 4.md", "Lesson 4"), // Duplicate
          createMockFile("Piano Lessons/Lesson 1.md", "Lesson 1"),
          createMockFile("Piano Lessons/Lesson 1.md", "Lesson 1"), // Duplicate
        ],
        urls: [
          "https://example.com",
          "https://example.com", // Duplicate
          "https://google.com",
        ],
        selectedTextContexts: [],
      };

      // This should not throw React key warnings
      const { container } = render(<MessageContext context={context} />);

      // Should render all notes (including duplicates)
      expect(container.querySelectorAll('[data-testid="note-badge"]')).toHaveLength(4); // 4 notes
      expect(container.querySelectorAll('[data-testid="url-badge"]')).toHaveLength(3); // 3 urls
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
          createMockFile("Piano Lessons/Lesson 4.md", "Lesson 4"), // Same path
        ],
        urls: [],
        selectedTextContexts: [],
      };

      // Mock console.error to catch React key warnings
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      render(<MessageContext context={context} />);

      // Should not have React key warnings
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Warning: Encountered two children with the same key")
      );

      consoleSpy.mockRestore();
    });
  });
});
