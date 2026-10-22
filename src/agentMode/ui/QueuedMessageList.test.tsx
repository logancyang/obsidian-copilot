import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
describe("QueuedMessageList", () => {
  describe("QueuedMessageList()", () => {
    it("labels image-only rows and keeps their removal https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      const onRemove = jest.fn();
      render(
        <QueuedMessageList
          delivering={[]}
          held={[
            {
              id: "image",
              text: "",
              rawInput: "",
              promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
            },
          ]}
          onRemove={onRemove}
        />
      );
      expect(screen.getByTitle("Image attachment")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
      expect(onRemove).toHaveBeenCalledWith("image");
    });
    it("labels an empty command without claiming it contains an image https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      render(
        <QueuedMessageList
          delivering={[]}
          held={[{ id: "empty", text: "", rawInput: "/empty" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Empty message")).toBeTruthy();
    });
    it("displays the text of a queued message", () => {
      render(
        <QueuedMessageList
          delivering={[]}
          held={[{ id: "text", text: "Explain this", rawInput: "Explain this" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Explain this")).toBeTruthy();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 marks a message handed to the agent as Queued, without a remove control, until it reaches the agent", () => {
      render(
        <QueuedMessageList
          delivering={[{ id: "steer", text: "Only the first two" }]}
          held={[]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Only the first two")).toBeTruthy();
      expect(screen.getByText("Queued")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Remove queued message" })).toBeNull();
      expect(screen.queryByText("Sends when the agent finishes")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 tells the user that messages Copilot holds send when the agent finishes", () => {
      render(
        <QueuedMessageList
          delivering={[]}
          held={[{ id: "held", text: "Next question", rawInput: "Next question" }]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByText("Sends when the agent finishes")).toBeTruthy();
    });
  });
});
