import React from "react";
import { render, screen } from "@testing-library/react";
import { ToolCallBanner } from "@/components/chat-components/ToolCallBanner";

// Mock the Collapsible components from Radix UI
jest.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    <div data-testid="collapsible" data-open={open}>
      {children}
    </div>
  ),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-content">{children}</div>
  ),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-trigger">{children}</div>
  ),
}));

// Mock lucide-react icons
jest.mock("lucide-react", () => ({
  Check: () => <div data-testid="check-icon">Check</div>,
  X: () => <div data-testid="x-icon">X</div>,
  ChevronRight: () => <div data-testid="chevron-icon">ChevronRight</div>,
}));

// Mock the ToolResultFormatter
jest.mock("@/tools/ToolResultFormatter", () => ({
  ToolResultFormatter: {
    format: jest.fn((_toolName: string, result: string) => result),
  },
}));

describe("ToolCallBanner", () => {
  const defaultProps = {
    toolName: "testTool",
    displayName: "Test Tool",
    emoji: "🔧",
  };

  describe("actuallyExecuting logic (defensive check)", () => {
    it("should show animation when executing with no result", () => {
      const { container } = render(
        <ToolCallBanner {...defaultProps} isExecuting={true} result={null} />
      );

      // Check for shimmer animation container
      const shimmerOverlay = container.querySelector(".tw-absolute.tw-inset-0.tw-z-\\[1\\]");
      expect(shimmerOverlay).not.toBeNull();

      // Check for "Calling" text
      expect(screen.getByText(/Calling Test Tool/)).toBeTruthy();
    });

    it("should hide animation when not executing with result", () => {
      const { container } = render(
        <ToolCallBanner {...defaultProps} isExecuting={false} result="Success" />
      );

      // Shimmer animation should NOT be present
      const shimmerOverlay = container.querySelector(".tw-absolute.tw-inset-0.tw-z-\\[1\\]");
      expect(shimmerOverlay).toBeNull();

      // Check for "Called" text (past tense)
      expect(screen.getByText(/Called Test Tool/)).toBeTruthy();
    });

    it("should hide animation when executing=true but result is present (bug fix)", () => {
      const { container } = render(
        <ToolCallBanner {...defaultProps} isExecuting={true} result="Success" />
      );

      // This is the key test: even though isExecuting=true, we have a result,
      // so the animation should NOT run (actuallyExecuting = false)
      const shimmerOverlay = container.querySelector(".tw-absolute.tw-inset-0.tw-z-\\[1\\]");
      expect(shimmerOverlay).toBeNull();

      // Should show "Called" since we have a result
      expect(screen.getByText(/Called Test Tool/)).toBeTruthy();
    });

    it("should hide animation when not executing with empty result", () => {
      const { container } = render(
        <ToolCallBanner {...defaultProps} isExecuting={false} result="" />
      );

      // Shimmer animation should NOT be present
      const shimmerOverlay = container.querySelector(".tw-absolute.tw-inset-0.tw-z-\\[1\\]");
      expect(shimmerOverlay).toBeNull();

      // Check for "Called" text
      expect(screen.getByText(/Called Test Tool/)).toBeTruthy();
    });
  });

  describe("expansion behavior", () => {
    it("should not allow expansion while executing without result", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={true} result={null} />);

      const collapsible = screen.getByTestId("collapsible");
      expect(collapsible.getAttribute("data-open")).toBe("false");
    });

    it("should allow expansion when not executing with result", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={false} result="Success" />);

      const collapsible = screen.getByTestId("collapsible");
      // Initially closed, but can be opened
      expect(collapsible.getAttribute("data-open")).toBe("false");
    });

    it("should allow expansion when executing=true but has result (actuallyExecuting=false)", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={true} result="Success" />);

      const collapsible = screen.getByTestId("collapsible");
      // Should be expandable since we have a result
      expect(collapsible.getAttribute("data-open")).toBe("false");
    });
  });

  describe("text rendering", () => {
    it('should show "Calling" when executing without result', () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={true} result={null} />);
      expect(screen.getByText(/Calling Test Tool/)).toBeTruthy();
    });

    it('should show "Called" when not executing with result', () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={false} result="Success" />);
      expect(screen.getByText(/Called Test Tool/)).toBeTruthy();
    });

    it("should show confirmation message when executing and message provided", () => {
      render(
        <ToolCallBanner
          {...defaultProps}
          isExecuting={true}
          result={null}
          confirmationMessage="Processing data"
        />
      );
      expect(screen.getByText(/Processing data/)).toBeTruthy();
    });

    it('should use "Reading/Read" for readNote tool', () => {
      render(
        <ToolCallBanner
          {...defaultProps}
          toolName="readNote"
          displayName="MyNote.md"
          isExecuting={true}
          result={null}
        />
      );
      expect(screen.getByText(/Reading MyNote.md/)).toBeTruthy();
    });

    it('should use "Read" for readNote tool with result', () => {
      render(
        <ToolCallBanner
          {...defaultProps}
          toolName="readNote"
          displayName="MyNote.md"
          isExecuting={false}
          result="Note content"
        />
      );
      expect(screen.getByText(/Read MyNote.md/)).toBeTruthy();
    });
  });

  describe("result formatting", () => {
    it("should format and display result in collapsible content", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={false} result="Success result" />);

      const content = screen.getByTestId("collapsible-content");
      expect(content).toBeTruthy();
      expect(content.textContent).toContain("Success result");
    });

    it("should handle very long results with truncation message", () => {
      const longResult = "a".repeat(6000); // Exceeds MAX_DISPLAY_CHARS (5000)
      render(<ToolCallBanner {...defaultProps} isExecuting={false} result={longResult} />);

      const content = screen.getByTestId("collapsible-content");
      expect(content.textContent).toMatch(/returned 6,000 characters.*preserved in chat history/);
    });

    it("should not show result while executing", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={true} result={null} />);

      const content = screen.getByTestId("collapsible-content");
      expect(content.textContent).toContain("No result available");
    });
  });

  describe("accept/reject buttons", () => {
    it("should not show accept/reject buttons when executing", () => {
      const onAccept = jest.fn();
      const onReject = jest.fn();

      render(
        <ToolCallBanner
          {...defaultProps}
          isExecuting={true}
          result={null}
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      // Buttons should not be visible during execution
      expect(screen.queryByTitle("Accept")).toBeNull();
      expect(screen.queryByTitle("Reject")).toBeNull();
    });

    it("should show accept/reject buttons when not executing with handlers", () => {
      const onAccept = jest.fn();
      const onReject = jest.fn();

      render(
        <ToolCallBanner
          {...defaultProps}
          isExecuting={false}
          result="Success"
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      // Buttons should be visible when done
      expect(screen.getByTitle("Accept")).toBeTruthy();
      expect(screen.getByTitle("Reject")).toBeTruthy();
    });

    it("should not show buttons when executing=true but has result (actuallyExecuting=false)", () => {
      const onAccept = jest.fn();
      const onReject = jest.fn();

      render(
        <ToolCallBanner
          {...defaultProps}
          isExecuting={true}
          result="Success"
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      // Buttons SHOULD be visible since actuallyExecuting=false
      expect(screen.getByTitle("Accept")).toBeTruthy();
      expect(screen.getByTitle("Reject")).toBeTruthy();
    });
  });
});
