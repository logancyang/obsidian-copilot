import type { WireMessage, WireQuestionPrompt } from "@/agentMode/protocol/state";
import type { CurrentPlan, PermissionPrompt, SessionId } from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentPaneCapabilitiesProvider } from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient, inertPaneCapabilities } from "@/agentMode/ui/agentPane.fixtures";
import { AI_SENDER } from "@/constants";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockSingleMessageRender = jest.fn();
const mockTrailRender = jest.fn();
const mockScrollState = { paused: false, onResume: jest.fn() };

jest.mock("@/hooks/useChatScrolling", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useChatScrolling: () => ({
    containerMinHeight: 0,
    scrollContainerCallbackRef: jest.fn(),
    contentCallbackRef: jest.fn(),
    onScroll: jest.fn(),
    isScrollPaused: mockScrollState.paused,
    scrollToEnd: mockScrollState.onResume,
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
  ToolPermissionCard: ({
    request,
    toolName,
    onResolve,
  }: {
    request: PermissionPrompt;
    toolName?: string;
    onResolve: (toolCallId: string, optionId: string) => void;
  }) => (
    <div>
      Permission {request.toolCall.toolCallId}
      {toolName ? ` via ${toolName}` : ""}
      <button
        type="button"
        aria-label="Allow"
        onClick={() => onResolve(request.toolCall.toolCallId, "allow")}
      />
    </div>
  ),
}));

jest.mock("@/agentMode/ui/AskUserQuestionCard", () => ({
  AskUserQuestionCard: ({
    request,
    onResolve,
  }: {
    request: WireQuestionPrompt;
    onResolve: (requestId: string, answers: Record<string, string>) => void;
  }) => (
    <div>
      Question {request.requestId}
      <button
        type="button"
        aria-label="Answer"
        onClick={() => onResolve(request.requestId, { [request.requestId]: "Yes" })}
      />
    </div>
  ),
}));

jest.mock("@/agentMode/ui/PlanProposalCard", () => ({
  PlanProposalCard: ({ plan }: { plan: CurrentPlan }) => <div>Plan {plan.id}</div>,
}));

function assistantMessage(
  id: string,
  timestampMs: number,
  overrides: Partial<WireMessage> = {}
): WireMessage {
  return {
    id,
    sender: AI_SENDER,
    message: "Finished response",
    timestamp: { epoch: timestampMs, display: "", fileName: "" },
    isVisible: true,
    ...overrides,
  };
}

function permission(id: string): PermissionPrompt {
  return {
    sessionId: "session-1",
    toolCall: { toolCallId: id, status: "pending", title: id },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  };
}

function question(id: string): WireQuestionPrompt {
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

const SESSION_ID = "session-1" as SessionId;

interface RenderOptions {
  sourcePath?: string;
  pendingToolPermissions?: PermissionPrompt[];
  pendingAskUserQuestions?: WireQuestionPrompt[];
  currentPlan?: CurrentPlan | null;
}

function renderMessages(messages: WireMessage[], isLoading: boolean, options: RenderOptions = {}) {
  const fixture = createFixtureClient({
    sessionId: SESSION_ID,
    session: {
      transcript: messages,
      plan: options.currentPlan ?? null,
      pending: {
        permissions: options.pendingToolPermissions ?? [],
        questions: options.pendingAskUserQuestions ?? [],
        planPermission: false,
      },
    },
  });
  const element = (loading: boolean) => (
    <AgentPaneCapabilitiesProvider value={inertPaneCapabilities}>
      <AgentChatMessages
        client={fixture.client}
        sessionId={SESSION_ID}
        app={{} as never}
        sourcePath={options.sourcePath}
        isLoading={loading}
      />
    </AgentPaneCapabilitiesProvider>
  );
  const view = render(element(isLoading));
  return { ...view, fixture, setLoading: (loading: boolean) => view.rerender(element(loading)) };
}

describe("AgentChatMessages", () => {
  describe("AgentChatMessages()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(200_000);
      mockSingleMessageRender.mockClear();
      mockTrailRender.mockClear();
      mockScrollState.paused = false;
      mockScrollState.onResume.mockClear();
    });

    afterEach(() => jest.useRealTimers());

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/277 shows a return control over the paused transcript and resumes following on click", () => {
      mockScrollState.paused = true;
      renderMessages([assistantMessage("response", 1_000)], false);

      fireEvent.click(screen.getByRole("button", { name: "Scroll to end" }));
      expect(mockScrollState.onResume).toHaveBeenCalledTimes(1);
    });

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
      const { container, fixture, setLoading } = renderMessages([completed], false);
      expect(screen.getByText("51s")).toBeTruthy();

      act(() => {
        fixture.emitSession({
          t: "msg.add",
          message: assistantMessage("answer-2", 198_000, { message: "", parts: [] }),
        });
      });
      setLoading(true);

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
      const { fixture } = renderMessages([user, completed, live], true);
      const originalUser = mockSingleMessageRender.mock.calls[0][0];
      const originalCompletedParts = mockTrailRender.mock.calls[0][0];

      act(() => {
        fixture.emitSession({
          t: "msg.appendText",
          id: live.id,
          text: " and second point",
          atMs: 3_500,
        });
      });

      expect(mockSingleMessageRender).toHaveBeenCalledTimes(1);
      expect(mockSingleMessageRender.mock.calls[0][0]).toBe(originalUser);
      expect(mockTrailRender).toHaveBeenCalledTimes(3);
      expect(mockTrailRender.mock.calls[0][0]).toBe(originalCompletedParts);
      expect(screen.getAllByTestId("agent-trail-timestamp")).toHaveLength(2);
    });

    it("shows questions before permissions and reveals a permission after questions clear for https://github.com/logancyang/obsidian-copilot/issues/2948", () => {
      const { fixture } = renderMessages([assistantMessage("answer-1", 62_000)], false, {
        pendingToolPermissions: [permission("permission-first"), permission("permission-second")],
        pendingAskUserQuestions: [question("question-first")],
      });

      const rail = screen.getByRole("region", { name: "Pending agent actions" });
      const firstAction = rail.querySelector("[data-action-id]");
      expect(Array.from(rail.querySelectorAll("[data-action-id]"), (el) => el.textContent)).toEqual(
        ["Question question-first"]
      );
      expect(screen.getByTestId("chat-messages").textContent).not.toContain("question-first");

      act(() => {
        fixture.emitSession({
          t: "slice",
          key: "pending",
          value: {
            permissions: [permission("permission-first"), permission("permission-second")],
            questions: [],
            planPermission: false,
          },
        });
      });

      expect(Array.from(rail.querySelectorAll("[data-action-id]"), (el) => el.textContent)).toEqual(
        ["Permission permission-first"]
      );
      expect(rail.querySelector("[data-action-id]")).not.toBe(firstAction);
    });

    it("passes the pending permission the tool name its chat tool call shows for https://github.com/Brevilabs/obsidian-copilot-private/issues/599", () => {
      const toolTurn = assistantMessage("answer-1", 62_000, {
        parts: [
          { kind: "tool_call", id: "search-1", title: "websearch", status: "pending" },
        ] as WireMessage["parts"],
      });

      renderMessages([toolTurn], true, {
        pendingToolPermissions: [permission("search-1")],
      });

      expect(screen.getByRole("region", { name: "Pending agent actions" }).textContent).toBe(
        "Permission search-1 via websearch"
      );
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

    it("sends a resolvePermission command for the pending permission the user allows", async () => {
      const { fixture } = renderMessages([assistantMessage("answer-1", 62_000)], true, {
        pendingToolPermissions: [permission("permission-first")],
      });

      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
      await act(async () => undefined);

      expect(fixture.commands).toEqual([
        {
          name: "resolvePermission",
          sessionId: SESSION_ID,
          toolCallId: "permission-first",
          optionId: "allow",
        },
      ]);
    });

    it("sends an answerQuestion command carrying the answers the user gives", async () => {
      const { fixture } = renderMessages([assistantMessage("answer-1", 62_000)], true, {
        pendingAskUserQuestions: [question("question-first")],
      });

      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
      await act(async () => undefined);

      expect(fixture.commands).toEqual([
        {
          name: "answerQuestion",
          sessionId: SESSION_ID,
          requestId: "question-first",
          answers: { "question-first": "Yes" },
        },
      ]);
    });

    it("keeps a plan-only state in the transcript without creating an action rail", () => {
      renderMessages([], false, { currentPlan: plan("plan-1") });

      expect(screen.getByTestId("chat-messages").textContent).toContain("Plan plan-1");
      expect(screen.queryByTestId("agent-action-rail")).toBeNull();
    });
  });
});
