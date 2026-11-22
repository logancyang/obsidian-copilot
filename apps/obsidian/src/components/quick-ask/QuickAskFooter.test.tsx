import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuickAskFooter, type QuickAskFooterProps } from "@/components/quick-ask/QuickAskFooter";

function renderFooter(overrides: Partial<QuickAskFooterProps> = {}) {
  const props: QuickAskFooterProps = {
    models: [],
    selectedModel: "",
    onSelectModel: jest.fn(),
    includeNoteContext: false,
    onIncludeNoteContextChange: jest.fn(),
    isStreaming: false,
    canSubmit: true,
    onSubmit: jest.fn(),
    onStop: jest.fn(),
    ...overrides,
  };
  render(<QuickAskFooter {...props} />);
  return props;
}

describe("QuickAskFooter", () => {
  describe("QuickAskFooter()", () => {
    it("sends the message when Send is pressed", () => {
      const props = renderFooter();

      fireEvent.click(screen.getByTitle("Send message"));

      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });

    it("disables Send while there is nothing to submit", () => {
      renderFooter({ canSubmit: false });

      expect(screen.getByTitle("Send message")).toHaveProperty("disabled", true);
    });

    it("replaces Send with Stop while a reply is streaming", () => {
      const props = renderFooter({ isStreaming: true });

      fireEvent.click(screen.getByTitle("Stop generating"));

      expect(props.onStop).toHaveBeenCalledTimes(1);
      expect(screen.queryByTitle("Send message")).toBeNull();
    });

    it("hides Clear conversation when there is no conversation to clear", () => {
      renderFooter();
      expect(screen.queryByTitle("Clear conversation")).toBeNull();
    });

    it("clears the conversation when Clear conversation is pressed", () => {
      const props = renderFooter({ onClear: jest.fn() });

      fireEvent.click(screen.getByTitle("Clear conversation"));

      expect(props.onClear).toHaveBeenCalledTimes(1);
    });

    it("reports the Note context toggle", () => {
      const props = renderFooter();

      fireEvent.click(screen.getByRole("checkbox"));

      expect(props.onIncludeNoteContextChange).toHaveBeenCalledWith(true);
    });
  });
});
