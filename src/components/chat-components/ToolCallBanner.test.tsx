import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolCallBanner } from "@/components/chat-components/ToolCallBanner";

const defaultProps = {
  toolName: "testTool",
  displayName: "Test Tool",
  emoji: "🔧",
};

describe("ToolCallBanner", () => {
  describe("ToolCallBanner()", () => {
    it("announces a running call as 'Calling <tool>...' with its confirmation message", () => {
      render(
        <ToolCallBanner
          {...defaultProps}
          isExecuting={true}
          result={null}
          confirmationMessage="Processing data"
        />
      );

      expect(screen.getByText(/Calling Test Tool\.\.\./)).toBeTruthy();
      expect(screen.getByText(/Processing data/)).toBeTruthy();
    });

    it("announces a finished call as 'Called <tool>' and expands to show its result", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={false} result="Success result" />);

      expect(screen.getByText(/Called Test Tool/)).toBeTruthy();
      expect(screen.queryByText("Success result")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /Called Test Tool/ }));

      expect(screen.getByText("Success result")).toBeTruthy();
    });

    it("treats a call as finished once a result exists even if the executing flag is still set", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={true} result="Success" />);

      expect(screen.getByText(/Called Test Tool/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Called Test Tool/ }));
      expect(screen.getByText("Success")).toBeTruthy();
    });

    it("cannot be expanded while the call is still running", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={true} result={null} />);

      fireEvent.click(screen.getByRole("button", { name: /Calling Test Tool/ }));

      expect(screen.queryByText("No result available")).toBeNull();
    });

    it("cannot be expanded when a finished call returned an empty result", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={false} result="" />);

      fireEvent.click(screen.getByRole("button", { name: /Called Test Tool/ }));

      expect(screen.queryByText("No result available")).toBeNull();
    });

    it.each([
      { isExecuting: true, result: null, expected: "Reading MyNote.md" },
      { isExecuting: false, result: "Note content", expected: "Read MyNote.md" },
    ])("uses read wording for readNote ($expected)", ({ isExecuting, result, expected }) => {
      render(
        <ToolCallBanner
          {...defaultProps}
          toolName="readNote"
          displayName="MyNote.md"
          isExecuting={isExecuting}
          result={result}
        />
      );

      expect(screen.getByText(expected)).toBeTruthy();
    });

    it("replaces an oversized result with a character-count notice when expanded", () => {
      render(<ToolCallBanner {...defaultProps} isExecuting={false} result={"a".repeat(6000)} />);

      fireEvent.click(screen.getByRole("button", { name: /Called Test Tool/ }));

      expect(screen.getByText(/returned 6,000 characters.*preserved in chat history/)).toBeTruthy();
    });

    it("offers Accept and Reject once the call has a result and forwards each click without expanding", () => {
      const onAccept = jest.fn();
      const onReject = jest.fn();
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
      render(
        <ToolCallBanner
          {...defaultProps}
          isExecuting={true}
          result="Success"
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      fireEvent.click(screen.getByTitle("Accept"));
      fireEvent.click(screen.getByTitle("Reject"));

      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Success")).toBeNull();
      consoleError.mockRestore();
    });

    it("hides Accept and Reject while the call is still running", () => {
      render(
        <ToolCallBanner
          {...defaultProps}
          isExecuting={true}
          result={null}
          onAccept={jest.fn()}
          onReject={jest.fn()}
        />
      );

      expect(screen.queryByTitle("Accept")).toBeNull();
      expect(screen.queryByTitle("Reject")).toBeNull();
    });
  });
});
