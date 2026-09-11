import type { AgentQueuedTask } from "@/agentMode/session/AgentTaskCoordinator";
import type { AgentTaskSubmission } from "@/agentMode/session/voiceTypes";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const queuedTask = (
  taskId: string,
  submission: Partial<AgentTaskSubmission>,
  queueReason: AgentQueuedTask["queueReason"] = "busy"
): AgentQueuedTask => ({
  taskId,
  queueReason,
  submission: {
    submissionId: `submission-${taskId}`,
    conversationId: "chat-1",
    sourceMessageIds: [],
    source: "typed",
    presentation: "text",
    requestText: "",
    ...submission,
  },
});

describe("QueuedMessageList", () => {
  describe("QueuedMessageList()", () => {
    it("labels image-only rows while retaining context status and removal https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      const onRemove = jest.fn();
      render(
        <QueuedMessageList
          tasks={[
            queuedTask(
              "image",
              { promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }] },
              "context"
            ),
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
          tasks={[queuedTask("empty", { requestText: "", rawInput: "/empty" })]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Empty message")).toBeTruthy();
    });
    it("displays the text of a queued message", () => {
      render(
        <QueuedMessageList
          tasks={[queuedTask("text", { requestText: "Explain this" })]}
          onRemove={jest.fn()}
        />
      );
      expect(screen.getByTitle("Explain this")).toBeTruthy();
    });
  });
});
