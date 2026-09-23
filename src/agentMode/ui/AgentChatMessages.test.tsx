import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AI_SENDER } from "@/constants";
import { act, render, screen } from "@testing-library/react";
import React from "react";

type AgentChatMessagesProps = React.ComponentProps<typeof AgentChatMessages>;

const mockSingleMessageRender = jest.fn();
const mockTrailRender = jest.fn();

jest.mock("@/hooks/useChatScrolling", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useChatScrolling: () => ({
    containerMinHeight: 0,
    scrollContainerCallbackRef: jest.fn(),
    getMessageKey: (message: { id: string }) => message.id,
  }),
}));

jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({
    message,
    footerStart,
    sourcePath,
  }: {
    message: { message: string };
    footerStart?: React.ReactNode;
    sourcePath?: string;
  }) => {
    mockSingleMessageRender(message);
    return (
      <div data-source-path={sourcePath}>
        {message.message}
        <div data-testid="single-message-footer">{footerStart}</div>
      </div>
    );
  },
}));

jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({ timestamp, parts }: { timestamp?: string; parts: unknown[] }) => {
    mockTrailRender(parts);
    return <div data-testid="agent-trail-timestamp">{timestamp}</div>;
  },
}));

jest.mock("@/agentMode/ui/ToolPermissionCard", () => ({
  ToolPermissionCard: ({ request }: { request: PermissionPrompt }) => (
    <div>Permission {request.toolCall.toolCallId}</div>
  ),
}));

jest.mock("@/agentMode/ui/AskUserQuestionCard", () => ({
  AskUserQuestionCard: ({ request }: { request: AskUserQuestionPrompt }) => (
    <div>Question {request.requestId}</div>
  ),
}));

jest.mock("@/agentMode/ui/PlanProposalCard", () => ({
  PlanProposalCard: ({ plan }: { plan: CurrentPlan }) => <div>Plan {plan.id}</div>,
}));

function assistantMessage(
  id: string,
  timestampMs: number,
  overrides: Partial<AgentChatMessage> = {}
): AgentChatMessage {
  return {
    id,
    sender: AI_SENDER,
    message: "Finished response",
    timestamp: { epoch: timestampMs, display: "", fileName: "" },
    isVisible: true,
    ...overrides,
  };
}

const chatBackend = {
  resolveToolPermission: jest.fn(),
  resolveAskUserQuestion: jest.fn(),
} as unknown as AgentChatBackend;

function permission(id: string): PermissionPrompt {
  return {
    sessionId: "session-1",
    toolCall: { toolCallId: id, status: "pending", title: id },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  };
}

function question(id: string): AskUserQuestionPrompt {
  return {
    sessionId: "session-1",
    requestId: id,
    questions: [{ question: id, options: [{ label: "Yes" }] }],
  };
}

function plan(id: string): CurrentPlan {
  return {
    id,
    revision: 1,
    body: "Review the plan",
    title: "Plan",
    permissionGated: true,
    decision: "pending",
  };
}

function renderMessages(
  messages: AgentChatMessage[],
  isLoading: boolean,
  overrides: Partial<AgentChatMessagesProps> = {}
) {
  const props: AgentChatMessagesProps = {
    messages,
    app: {} as never,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    chatBackend,
    isLoading,
    ...overrides,
  };
  return { ...render(<AgentChatMessages {...props} />), props };
}

describe("AgentChatMessages", () => {
  describe("AgentChatMessages()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(200_000);
      mockSingleMessageRender.mockClear();
      mockTrailRender.mockClear();
    });

    afterEach(() => jest.useRealTimers());

    it("forwards the active session conversation path to user messages https://github.com/Brevilabs/obsidian-copilot-private/issues/539", () => {
      const { container } = renderMessages(
        [assistantMessage("user-1", 1, { sender: "user", message: "[[Findings]]" })],
        false,
        { sourcePath: "chat/Conversation.md" }
      );
      expect(
        container.querySelector('[data-source-path="chat/Conversation.md"]')?.textContent
      ).toContain("[[Findings]]");
    });

    it("retains the latest completed turn duration with a static icon", () => {
      const { container } = renderMessages(
        [assistantMessage("answer-1", 62_000, { turnDurationMs: 138_000 })],
        false
      );

      expect(screen.getByText("2m 18s")).toBeTruthy();
      expect(screen.getByTestId("single-message-footer").textContent).toContain(
        "Worked for 2m 18s"
      );
      expect(container.querySelector(".copilot-spinner")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner-dot-0")).toBeNull();
    });

    it("retires the prior duration when the next turn starts", () => {
      const completed = assistantMessage("answer-1", 1_000, { turnDurationMs: 51_000 });
      const { container, rerender, props } = renderMessages([completed], false);
      expect(screen.getByText("51s")).toBeTruthy();

      rerender(
        <AgentChatMessages
          {...props}
          messages={[completed, assistantMessage("answer-2", 198_000, { message: "", parts: [] })]}
          isLoading
        />
      );

      expect(screen.queryByText("51s")).toBeNull();
      expect(screen.getByText("2s")).toBeTruthy();
      expect(container.querySelector(".copilot-spinner")).toBeTruthy();

      act(() => jest.advanceTimersByTime(1_000));
      expect(screen.getByText("3s")).toBeTruthy();
    });

    it("passes the message timestamp to a structured trail without a duration", () => {
      const timestamp = "2026/08/07 20:31:10";
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            timestamp: { epoch: 62_000, display: timestamp, fileName: "20260807_203110" },
            parts: [{ kind: "thought", text: "Inspect the response." }],
          }),
        ],
        false
      );

      expect(screen.getByTestId("agent-trail-timestamp").textContent).toBe(timestamp);
    });

    it("keeps completed plain and structured turns mounted without rendering them again while the live turn streams https://github.com/logancyang/obsidian-copilot/issues/3343", () => {
      const user = assistantMessage("user-1", 1_000, {
        sender: "user",
        message: "Summarize this note",
      });
      const completed = assistantMessage("answer-1", 2_000, {
        parts: [{ kind: "text", text: "The note has three points." }],
      });
      const live = assistantMessage("answer-2", 3_000, {
        message: "First point",
        parts: [{ kind: "text", text: "First point" }],
      });
      const { rerender, props } = renderMessages([user, completed, live], true);
      const originalUser = mockSingleMessageRender.mock.calls[0][0];
      const originalCompletedParts = mockTrailRender.mock.calls[0][0];

      rerender(
        <AgentChatMessages
          {...props}
          messages={[
            user,
            completed,
            {
              ...live,
              message: "First point and second point",
              parts: [{ kind: "text", text: "First point and second point" }],
            },
          ]}
        />
      );

      expect(mockSingleMessageRender).toHaveBeenCalledTimes(1);
      expect(mockSingleMessageRender.mock.calls[0][0]).toBe(originalUser);
      expect(mockTrailRender).toHaveBeenCalledTimes(3);
      expect(mockTrailRender.mock.calls[0][0]).toBe(originalCompletedParts);
      expect(screen.getAllByTestId("agent-trail-timestamp")).toHaveLength(2);
    });

    it("shows questions before permissions and reveals a permission after questions clear for https://github.com/logancyang/obsidian-copilot/issues/2948", () => {
      const { rerender, props } = renderMessages([assistantMessage("answer-1", 62_000)], false, {
        pendingToolPermissions: [permission("permission-first"), permission("permission-second")],
        pendingAskUserQuestions: [question("question-first")],
      });

      const rail = screen.getByRole("region", { name: "Pending agent actions" });
      const firstAction = rail.querySelector("[data-action-id]");
      expect(Array.from(rail.querySelectorAll("[data-action-id]"), (el) => el.textContent)).toEqual(
        ["Question question-first"]
      );
      expect(screen.getByTestId("chat-messages").textContent).not.toContain("question-first");

      rerender(
        <AgentChatMessages
          {...props}
          pendingToolPermissions={[permission("permission-first"), permission("permission-second")]}
          pendingAskUserQuestions={[]}
        />
      );

      expect(Array.from(rail.querySelectorAll("[data-action-id]"), (el) => el.textContent)).toEqual(
        ["Permission permission-first"]
      );
      expect(rail.querySelector("[data-action-id]")).not.toBe(firstAction);
    });

    it("bounds and scrolls a tall action rail so controls remain reachable for https://github.com/logancyang/obsidian-copilot/issues/2948", () => {
      renderMessages([], false, {
        pendingAskUserQuestions: [question("empty-chat-question")],
      });

      const rail = screen.getByTestId("agent-action-rail");
      expect(rail.textContent).toContain("empty-chat-question");
      expect(rail.className).toContain("tw-w-full");
      expect(rail.className).toContain("tw-max-h-full");
      expect(rail.className).toContain("tw-overflow-y-auto");
      expect(rail.className).not.toContain("tw-shrink-0");
      expect(rail.className).not.toContain("tw-border");
    });

    it("keeps a plan-only state in the transcript without creating an action rail", () => {
      renderMessages([], false, { currentPlan: plan("plan-1") });

      expect(screen.getByTestId("chat-messages").textContent).toContain("Plan plan-1");
      expect(screen.queryByTestId("agent-action-rail")).toBeNull();
    });
  });
});
