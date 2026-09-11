import { AgentVoiceTaskCard } from "@/agentMode/ui/AgentVoiceTaskCard";
import type { AgentTaskRecord } from "@/agentMode/session/voiceTypes";
import type { App } from "obsidian";
import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({ isStreaming }: { isStreaming: boolean }) => (
    <span>{isStreaming ? "Live activity" : "Finished activity"}</span>
  ),
}));
jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({ message }: { message: { message: string } }) => <span>{message.message}</span>,
}));
const task: AgentTaskRecord = {
  taskId: "task-1",
  sourceMessageIds: [],
  delegationIds: [],
  presentation: "voice-card",
  state: "completed",
  assistantMessageId: "answer",
};

describe("AgentVoiceTaskCard", () => {
  describe("AgentVoiceTaskCard()", () => {
    it("keeps a completed backend answer available inside its task card", () => {
      render(
        <AgentVoiceTaskCard
          task={task}
          app={{} as App}
          backendDisplayName="Codex"
          details={{
            task,
            activityAvailable: true,
            messages: [
              {
                id: "answer",
                sender: "ai",
                message: "Found three notes.",
                timestamp: null,
                isVisible: true,
              },
            ],
          }}
        />
      );
      expect(screen.getByText("Codex · Completed")).toBeTruthy();
      expect(screen.getByText("Found three notes.").closest("details")).toBeTruthy();
    });
    it("keeps activity streaming when the task needs a user decision", () => {
      render(
        <AgentVoiceTaskCard
          task={{ ...task, state: "awaiting-user" }}
          app={{} as App}
          backendDisplayName="Claude"
          details={{
            task,
            activityAvailable: true,
            messages: [
              {
                id: "answer",
                sender: "ai",
                message: "",
                timestamp: null,
                isVisible: true,
                parts: [{ kind: "text", text: "Review this change." }],
              },
            ],
          }}
        />
      );
      expect(screen.getByText("Claude · Needs your input")).toBeTruthy();
      expect(screen.getByText("Live activity")).toBeTruthy();
    });
    it("states that queued work has not steered the running task", () => {
      render(
        <AgentVoiceTaskCard
          task={{ ...task, state: "queued" }}
          app={{} as App}
          backendDisplayName="Codex"
        />
      );
      expect(screen.getByText(/This has not changed the running task/)).toBeTruthy();
    });
  });
});
