import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ContentArea } from "./content-area";

const renderMarkdown = async (content: string, el: HTMLElement) => {
  el.textContent = content;
};

describe("content-area", () => {
  describe("ContentArea()", () => {
    it("copies a finished rendered result from the result box", () => {
      const onCopy = jest.fn();
      render(
        <ContentArea
          state={{ type: "result", text: "Rewritten text" }}
          renderMarkdown={renderMarkdown}
          onCopy={onCopy}
        />
      );
      fireEvent.click(screen.getByTitle("Copy to clipboard"));
      expect(onCopy).toHaveBeenCalledTimes(1);
    });
    it("keeps the copy control while the result is being edited", () => {
      render(
        <ContentArea
          state={{ type: "result", text: "Rewritten text" }}
          editable
          value="Rewritten text"
          disableAutoGrow
          renderMarkdown={renderMarkdown}
          onCopy={() => undefined}
        />
      );
      fireEvent.click(screen.getByTitle("Edit content"));
      expect(screen.getByTitle("Copy to clipboard")).not.toBeNull();
    });
    it("withholds copy while the result is still streaming", () => {
      render(
        <ContentArea
          state={{ type: "result", text: "Partial", isStreaming: true }}
          disableAutoGrow
          renderMarkdown={renderMarkdown}
          onCopy={() => undefined}
        />
      );
      expect(screen.queryByTitle("Copy to clipboard")).toBeNull();
    });
  });
});
