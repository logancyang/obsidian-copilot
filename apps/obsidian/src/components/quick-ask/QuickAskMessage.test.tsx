import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { Component, MarkdownRenderer } from "obsidian";
import { QuickAskMessageComponent } from "@/components/quick-ask/QuickAskMessage";
import type { QuickAskMessage } from "@/components/quick-ask/types";

jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  MarkdownRenderer: { renderMarkdown: jest.fn(async () => undefined) },
}));

HTMLElement.prototype.empty = function (this: HTMLElement): void {
  this.replaceChildren();
};

const REPLY: QuickAskMessage = {
  id: "reply-1",
  role: "assistant",
  content: "Use **went** instead of go.",
  timestamp: 1,
};

function renderMessage(overrides: Partial<React.ComponentProps<typeof QuickAskMessageComponent>>) {
  const component = new Component();
  render(
    <QuickAskMessageComponent
      message={REPLY}
      isStreaming={false}
      isLastAssistantMessage
      onCopy={jest.fn()}
      onInsert={jest.fn()}
      onReplace={jest.fn()}
      hasSelection={false}
      isReplaceValid={false}
      replaceInvalidReason={null}
      filePathSnapshot="Notes/Essay.md"
      component={component}
      {...overrides}
    />
  );
  return { component };
}

describe("QuickAskMessage", () => {
  describe("QuickAskMessageComponent()", () => {
    beforeEach(() => {
      jest.mocked(MarkdownRenderer.renderMarkdown).mockClear();
    });

    it("renders a finished reply as Markdown from the note, owned by the given component", async () => {
      const { component } = renderMessage({});

      await waitFor(() => expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledTimes(1));
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
        "Use **went** instead of go.",
        expect.any(HTMLElement),
        "Notes/Essay.md?no-dataview",
        component
      );
    });

    it("shows a streaming reply as plain text without rendering Markdown", () => {
      renderMessage({ isStreaming: true });

      expect(screen.getByText("Use **went** instead of go.")).toBeTruthy();
      expect(MarkdownRenderer.renderMarkdown).not.toHaveBeenCalled();
    });
  });
});
