import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
describe("QueuedMessageList", () => {
  describe("QueuedMessageList()", () => {
    it("labels image-only rows while retaining context status and removal https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      const onRemove = jest.fn();
      render(
        <QueuedMessageList
          messages={[
            {
              id: "image",
              text: "",
              rawInput: "",
              promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
              queueReason: "context",
            },
          ]}
          onRemove={onRemove}
        />
      );
      expect(screen.getByTitle("Image attachment")).toBeTruthy();
      expect(screen.getByText("Waiting for context ·")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
      expect(onRemove).toHaveBeenCalledWith("image");
    });
    it("labels an empty command without claiming it contains an image https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      render(
        <QueuedMessageList
          messages={[{ id: "empty", text: "", rawInput: "/empty" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Empty message")).toBeTruthy();
    });
    it("displays the text of a queued message", () => {
      render(
        <QueuedMessageList
          messages={[{ id: "text", text: "Explain this", rawInput: "Explain this" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Explain this")).toBeTruthy();
    });
  });
});
