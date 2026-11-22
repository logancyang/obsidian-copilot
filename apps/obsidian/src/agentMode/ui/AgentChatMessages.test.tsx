import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { readOpencodeCopilotTools } from "@/agentMode/backends/opencode/opencodeCopilotToolCalls";
import { directCopilotToolUse } from "@/agentMode/session/copilotToolCalls";
import { makeTask } from "@/agentMode/ui/testing/taskFixtures";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  TurnFileChange,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { FEEDBACK_OFFER, type FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import { EMPTY_CHAT_STATES, withChatState } from "@/agentMode/session/chatExtension";
import { CONNECTOR_CARDS } from "@/connectors/agentMode/connectorCards";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { AppContext } from "@/context";
import type { App } from "obsidian";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { logError } from "@/logger";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { formatAgentReply } from "@/agents/agentReply";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

type AgentChatMessagesProps = React.ComponentProps<typeof AgentChatMessages>;

const mockSingleMessageRender = jest.fn();
const mockTrailRender = jest.fn();
const mockScrollState = { paused: false, onResume: jest.fn() };

jest.mock("@/hooks/useChatScrolling", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useChatScrolling: () => ({
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
    responseText,
    hideFooter,
    sourcePath,
    onContinue,
  }: {
    message: { message: string };
    footerStart?: React.ReactNode;
    responseText?: string;
    hideFooter?: boolean;
    sourcePath?: string;
    onContinue?: () => void;
  }) => {
    mockSingleMessageRender(message);
    return (
      <div
        data-testid="single-message"
        data-source-path={sourcePath}
        data-response-text={responseText}
        data-row={hideFooter ? "none" : "shown"}
      >
        {message.message}
        <div data-testid="single-message-footer">{footerStart}</div>
        {onContinue ? (
          <button type="button" onClick={onContinue}>
            Continue {message.message}
          </button>
        ) : null}
      </div>
    );
  },
}));

jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({
    timestampMs,
    turnDurationMs,
    responseText,
    hideFooter,
    parts,
    errorText,
    agentCancelCause,
    fileChanges,
    memorySaves,
    onOpenFileChange,
    onContinue,
  }: {
    timestampMs?: number;
    turnDurationMs?: number;
    responseText?: string;
    hideFooter?: boolean;
    parts: unknown[];
    errorText?: string;
    agentCancelCause?: string;
    fileChanges?: TurnFileChange[];
    memorySaves?: { byCall: ReadonlyMap<string, unknown> } | null;
    onOpenFileChange?: (change: TurnFileChange) => void;
    onContinue?: () => void;
  }) => {
    mockTrailRender(parts);
    return (
      <div
        data-testid="agent-trail-timestamp"
        data-response-text={responseText}
        data-row={hideFooter ? "none" : "shown"}
        data-duration={turnDurationMs}
      >
        {timestampMs}
        {memorySaves ? (
          <span data-testid="agent-trail-memory-anchor">
            {Array.from(memorySaves.byCall.keys()).join(",")}
          </span>
        ) : null}
        {onContinue ? (
          <button type="button" onClick={onContinue}>
            Continue trail
          </button>
        ) : null}
        {errorText ? <span data-testid="agent-trail-error">{errorText}</span> : null}
        {agentCancelCause ? (
          <span data-testid="agent-trail-cancel-cause">{agentCancelCause}</span>
        ) : null}
        {fileChanges?.map((change) => (
          <button key={change.path} type="button" onClick={() => onOpenFileChange?.(change)}>
            {change.path}
          </button>
        ))}
      </div>
    );
  },
}));

jest.mock("@/entitlement");

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div>{text}</div>,
}));

jest.mock("@/agentMode/ui/TurnDiffView", () => ({
  openTurnDiff: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/logger", () => ({ ...jest.requireActual("@/logger"), logError: jest.fn() }));

jest.mock("@/agentMode/ui/ToolPermissionCard", () => ({
  ToolPermissionCard: ({
    request,
    toolName,
    requester,
  }: {
    request: PermissionPrompt;
    toolName?: string;
    requester?: React.ReactNode;
  }) => (
    <div title={request.toolCall.title}>
      Permission {request.toolCall.toolCallId}
      {toolName ? ` via ${toolName}` : ""}
      {requester ? <> from {requester}</> : null}
    </div>
  ),
}));

jest.mock("@/agentMode/ui/AskUserQuestionCard", () => ({
  AskUserQuestionCard: ({ request }: { request: AskUserQuestionPrompt }) => (
    <div>Question {request.requestId}</div>
  ),
}));

jest.mock("@/connectors/ui/ConnectorChatCard", () => ({
  ConnectorChatCard: ({ serviceId }: { serviceId: string }) => <div>Connect card {serviceId}</div>,
}));

jest.mock("@/agentMode/ui/PlanProposalCard", () => ({
  PlanProposalCard: ({ plan }: { plan: CurrentPlan }) => <div>Plan {plan.id}</div>,
}));

const FILE_CHANGE: TurnFileChange = {
  path: "notes/diff-demo/alpha.md",
  status: "modified",
  before: "The quick brown fox.\n",
  after: "The quick red fox.\n",
  additions: 1,
  deletions: 1,
};

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
  updateChatState: jest.fn(),
} as unknown as AgentChatBackend;

const OPEN_OFFER: FeedbackOffer = {
  trigger: "agent",
  draft: {
    title: "Replied in Swedish to an English request",
    whatHappened: "The agent answered 'hej'.",
    userSaid: "Why do you switch languages?",
    repro: "1. Ask in English.",
  },
  evidence: { backendId: "codex", model: "gpt-6.1-sol", sessionId: "s-1", raisedAt: "t" },
  afterUserMessageId: "user-1",
  status: "open",
};

const FEEDBACK_TRANSCRIPT = [
  assistantMessage("user-1", 1, { sender: "user", message: "why?" }),
  assistantMessage("reply-1", 2, { message: "Sorry about that." }),
  assistantMessage("user-2", 3, { sender: "user", message: "next question" }),
  assistantMessage("reply-2", 4, { message: "Next answer." }),
];

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

function messagesProps(
  messages: AgentChatMessage[],
  isLoading: boolean,
  overrides: Partial<AgentChatMessagesProps> = {}
): AgentChatMessagesProps {
  return {
    messages,
    plugin: { app: {}, manifest: { version: "4.1.0" } } as never,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    chatBackend,
    isLoading,
    chatStates: EMPTY_CHAT_STATES,
    ...overrides,
  };
}

function renderMessages(
  messages: AgentChatMessage[],
  isLoading: boolean,
  overrides: Partial<AgentChatMessagesProps> = {}
) {
  const props = messagesProps(messages, isLoading, overrides);
  return { ...render(<AgentChatMessages {...props} />), props };
}

function rowsOf(
  replies: HTMLElement[]
): Array<[string | undefined, string | undefined, string | undefined]> {
  return replies.map((reply) => [
    reply.dataset.row,
    reply.dataset.responseText,
    reply.dataset.duration,
  ]);
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

    it("renders only the last 10 messages of a long chat and adds earlier turns as the top comes into view https://github.com/logancyang/obsidian-copilot/issues/4248", () => {
      const originalObserver = window.IntersectionObserver;
      let reportTop: IntersectionObserverCallback = () => undefined;
      window.IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
        reportTop = callback;
        return { observe: jest.fn(), disconnect: jest.fn() };
      }) as unknown as typeof IntersectionObserver;
      try {
        const transcript = Array.from({ length: 30 }, (_, i) =>
          i % 2 === 0
            ? assistantMessage(`user-${i}`, i, { sender: "user", message: `question ${i}` })
            : assistantMessage(`reply-${i}`, i, { message: `answer ${i}` })
        );
        renderMessages(transcript, false);

        expect(screen.queryByText("question 18")).toBeNull();
        expect(screen.getByText("question 20")).toBeTruthy();
        expect(screen.getByText("question 28")).toBeTruthy();

        act(() => reportTop([{ isIntersecting: true } as IntersectionObserverEntry], {} as never));

        expect(screen.getByText("question 10")).toBeTruthy();
        expect(screen.queryByText("question 8")).toBeNull();
      } finally {
        window.IntersectionObserver = originalObserver;
      }
    });

    it("shows the feedback card right after the reply of the turn that raised it", () => {
      const { container } = renderMessages(FEEDBACK_TRANSCRIPT, false, {
        chatStates: withChatState(EMPTY_CHAT_STATES, FEEDBACK_OFFER, OPEN_OFFER),
      });

      const text = container.textContent ?? "";
      expect(screen.getByTestId("agent-feedback-card")).toBeTruthy();
      expect(text.indexOf("Sorry about that.")).toBeLessThan(
        text.indexOf("Report this to the Copilot team?")
      );
      expect(text.indexOf("Report this to the Copilot team?")).toBeLessThan(
        text.indexOf("next question")
      );
    });

    it("hides a dismissed feedback card", () => {
      renderMessages(FEEDBACK_TRANSCRIPT, false, {
        chatStates: withChatState(EMPTY_CHAT_STATES, FEEDBACK_OFFER, {
          ...OPEN_OFFER,
          status: "dismissed",
        }),
      });

      expect(screen.queryByTestId("agent-feedback-card")).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/860 shows each connector card after the reply of the turn that asked for it, beside its feedback card, and hides dismissed ones", () => {
      const chatStates = withChatState(
        withChatState(EMPTY_CHAT_STATES, FEEDBACK_OFFER, OPEN_OFFER),
        CONNECTOR_CARDS,
        [
          { serviceId: "notion", afterUserTurn: 1, dismissed: false, reported: null },
          { serviceId: "linear", afterUserTurn: 2, dismissed: false, reported: null },
          { serviceId: "todoist", afterUserTurn: 2, dismissed: true, reported: null },
        ]
      );

      const { container } = renderMessages(FEEDBACK_TRANSCRIPT, false, {
        chatStates,
        plugin: { app: {}, manifest: { version: "4.1.0" }, connectionManager: {} } as never,
      });

      const text = container.textContent ?? "";
      expect(text.indexOf("Report this to the Copilot team?")).toBeLessThan(
        text.indexOf("Connect card notion")
      );
      expect(text.indexOf("Connect card notion")).toBeLessThan(text.indexOf("next question"));
      expect(text.indexOf("Next answer.")).toBeLessThan(text.indexOf("Connect card linear"));
      expect(text).not.toContain("Connect card todoist");
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

    it("shows a finished reply's duration without a live timer while the agent keeps working on its subagents https://github.com/Brevilabs/obsidian-copilot-private/issues/757", () => {
      renderMessages(
        [
          assistantMessage("launch-reply", 1_000, {
            message: "LAUNCHED",
            turnStopReason: "end_turn",
            turnDurationMs: 12_000,
          }),
        ],
        true
      );

      expect(screen.getByText("12s")).toBeTruthy();
      expect(screen.queryByText("Working")).toBeNull();
    });

    it("passes the message's sent time to a structured trail without a duration", () => {
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            timestamp: { epoch: 62_000, display: "1970/01/01 00:01:02", fileName: "" },
            parts: [{ kind: "thought", text: "Inspect the response." }],
          }),
        ],
        false
      );

      expect(screen.getByTestId("agent-trail-timestamp").textContent).toBe("62000");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 gives a response of one reply one row, on that reply, with its text and its Worked for", () => {
      renderMessages(
        [
          assistantMessage("user-1", 1, { sender: USER_SENDER, message: "Draft the recap" }),
          assistantMessage("reply-a", 2, {
            parts: [{ kind: "text", text: "The draft is in Q4 recap." }],
            turnDurationMs: 46_000,
          }),
        ],
        false
      );

      expect(rowsOf(screen.getAllByTestId("agent-trail-timestamp"))).toEqual([
        ["shown", "The draft is in Q4 recap.", "46000"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 leaves a row on each response when a user message sits between them, and only the newest response's row shows Worked for", () => {
      renderMessages(
        [
          assistantMessage("user-1", 1, { sender: USER_SENDER, message: "Draft the recap" }),
          assistantMessage("reply-a", 2, {
            parts: [{ kind: "text", text: "Drafted." }],
            turnDurationMs: 46_000,
          }),
          assistantMessage("user-2", 3, { sender: USER_SENDER, message: "Shorten it" }),
          assistantMessage("reply-b", 4, {
            parts: [{ kind: "text", text: "Shortened." }],
            turnDurationMs: 18_000,
          }),
        ],
        false
      );

      expect(rowsOf(screen.getAllByTestId("agent-trail-timestamp"))).toEqual([
        ["shown", "Drafted.", undefined],
        ["shown", "Shortened.", "18000"],
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 shows no row on a response while its last reply is being written, nor on its earlier replies", () => {
      renderMessages(
        [
          assistantMessage("user-1", 1, { sender: USER_SENDER, message: "Draft the recap" }),
          assistantMessage("reply-a", 2, {
            parts: [{ kind: "text", text: "Drafted." }],
            turnDurationMs: 46_000,
            turnStopReason: "end_turn",
          }),
          assistantMessage("reply-b", 3, { parts: [{ kind: "text", text: "Checking" }] }),
        ],
        true
      );

      const [earlier, live] = rowsOf(screen.getAllByTestId("agent-trail-timestamp"));
      expect(earlier[0]).toBe("none");
      expect(live[2]).toBeUndefined();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 continues a chat from the last reply of a response, the only reply that offers it", async () => {
      const onContinueFrom = jest.fn().mockResolvedValue(undefined);
      renderMessages(
        [
          assistantMessage("user-1", 1_000, { sender: "user", message: "Question" }),
          assistantMessage("reply-a", 2_000, { parts: [{ kind: "text", text: "First" }] }),
          assistantMessage("reply-b", 3_000, { parts: [{ kind: "text", text: "Second" }] }),
        ],
        false,
        { onContinueFrom }
      );

      await act(async () => fireEvent.click(screen.getByText("Continue trail")));

      expect(onContinueFrom.mock.calls).toEqual([["reply-b"]]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 labels the first message of each day in a chat that spans days", () => {
      jest.setSystemTime(new Date(2026, 10, 18, 15, 0));
      renderMessages(
        [
          assistantMessage("user-1", new Date(2026, 10, 17, 14, 2).getTime(), {
            sender: USER_SENDER,
            message: "Draft the recap",
          }),
          assistantMessage("reply-1", new Date(2026, 10, 17, 14, 3).getTime()),
          assistantMessage("user-2", new Date(2026, 10, 18, 9, 15).getTime(), {
            sender: USER_SENDER,
            message: "Shorten it",
          }),
          assistantMessage("reply-2", new Date(2026, 10, 18, 9, 16).getTime()),
        ],
        false
      );

      const transcript = screen.getByTestId("chat-messages").textContent ?? "";
      expect(transcript.indexOf("Yesterday")).toBeLessThan(transcript.indexOf("Draft the recap"));
      expect(transcript.indexOf("Today")).toBeGreaterThan(transcript.indexOf("Draft the recap"));
      expect(transcript.indexOf("Today")).toBeLessThan(transcript.indexOf("Shorten it"));
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 labels a chat that began today with Yesterday once midnight passes with it open", () => {
      jest.setSystemTime(new Date(2026, 10, 18, 23, 59, 30));
      renderMessages(
        [
          assistantMessage("user-1", new Date(2026, 10, 18, 23, 50).getTime(), {
            sender: USER_SENDER,
            message: "Late question",
          }),
        ],
        false
      );
      expect(screen.queryByText("Yesterday")).toBeNull();

      act(() => {
        jest.advanceTimersByTime(60_000);
      });

      expect(screen.getByText("Yesterday")).toBeTruthy();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/633 hands a failed structured turn's error to its trail, which shows no error text for a message without parts", () => {
      renderMessages(
        [
          assistantMessage("failed-1", 62_000, {
            message: "**Error:** stream error",
            isErrorMessage: true,
            parts: [
              {
                kind: "compaction",
                id: "c1",
                status: "completed",
                trigger: "manual",
                startedAtMs: 0,
              },
            ],
          }),
          assistantMessage("ok-1", 63_000, {
            parts: [{ kind: "thought", text: "Fine." }],
          }),
        ],
        false
      );

      expect(screen.getAllByTestId("agent-trail-error").map((el) => el.textContent)).toEqual([
        "**Error:** stream error",
      ]);
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/4062 hands an agent-cancelled reply with no text or tool activity to the trail, so its stop notice shows", () => {
      renderMessages(
        [
          assistantMessage("cancelled-1", 62_000, {
            message: "",
            turnStopReason: "cancelled",
            agentCancelCause: "unspecified",
          }),
        ],
        false
      );

      expect(screen.getByTestId("agent-trail-cancel-cause").textContent).toBe("unspecified");
      expect(mockSingleMessageRender).not.toHaveBeenCalled();
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 offers to continue from each reply, text or with tool cards, only while the chat is idle, and names the chosen reply", async () => {
      const onContinueFrom = jest.fn().mockResolvedValue(undefined);
      const messages = [
        assistantMessage("user-1", 1_000, { sender: "user", message: "Question" }),
        assistantMessage("text-reply", 2_000, { message: "Saved answer" }),
        assistantMessage("user-2", 2_500, { sender: "user", message: "Follow-up" }),
        assistantMessage("trail-reply", 3_000, { parts: [{ kind: "text", text: "Live" }] }),
      ];
      const { rerender, props } = renderMessages(messages, false, { onContinueFrom });

      expect(screen.queryByText(/Continue (Question|Follow-up)/)).toBeNull();
      for (const label of ["Continue Saved answer", "Continue trail"]) {
        await act(async () => fireEvent.click(screen.getByText(label)));
      }
      rerender(<AgentChatMessages {...props} isLoading />);

      expect(onContinueFrom.mock.calls).toEqual([["text-reply"], ["trail-reply"]]);
      expect(screen.queryByText(/^Continue /)).toBeNull();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/908 continues a chat once for a double click, and again once the new chat has opened", async () => {
      let opened = () => {};
      const onContinueFrom = jest.fn(() => new Promise<void>((resolve) => (opened = resolve)));
      renderMessages(
        [
          assistantMessage("user-1", 1_000, { sender: "user", message: "Question" }),
          assistantMessage("text-reply", 2_000, { message: "Saved answer" }),
        ],
        false,
        { onContinueFrom }
      );

      fireEvent.click(screen.getByText("Continue Saved answer"));
      fireEvent.click(screen.getByText("Continue Saved answer"));
      const clicksWhileOpening = onContinueFrom.mock.calls.length;
      await act(async () => opened());
      fireEvent.click(screen.getByText("Continue Saved answer"));

      expect(clicksWhileOpening).toBe(1);
      expect(onContinueFrom).toHaveBeenCalledTimes(2);
    });

    it("lets the browser skip painting every reply that is scrolled out of view https://github.com/logancyang/obsidian-copilot/issues/3343", () => {
      renderMessages(
        [
          assistantMessage("user-1", 1_000, { sender: "user", message: "Summarize this note" }),
          assistantMessage("answer-1", 2_000, {
            parts: [{ kind: "text", text: "The note has three points." }],
          }),
        ],
        false
      );

      const reply = screen.getByTestId("agent-trail-timestamp").closest(".tw-w-full");
      expect(reply?.className).toContain("[content-visibility:auto]");
      expect(reply?.className).toContain("[contain-intrinsic-size:auto_500px]");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 paints a user message's row in full, so its floating bar is not cut off at the row's edge", () => {
      renderMessages(
        [assistantMessage("user-1", 1_000, { sender: "user", message: "Summarize this note" })],
        false
      );

      const row = screen.getByTestId("single-message").parentElement;
      expect(row?.className).not.toContain("content-visibility");
    });

    it("opens the clicked file's diff against the turn that changed it", () => {
      const app = {} as never;
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            parts: [{ kind: "thought", text: "Revise the note." }],
            turnStopReason: "end_turn",
            fileChanges: [FILE_CHANGE],
          }),
        ],
        false,
        { plugin: { app, manifest: { version: "4.1.0" } } as never }
      );

      fireEvent.click(screen.getByRole("button", { name: "notes/diff-demo/alpha.md" }));

      expect(openTurnDiff).toHaveBeenCalledWith(app, FILE_CHANGE, "answer-1");
    });

    it("logs a diff tab that fails to open instead of leaving the rejection unhandled", async () => {
      const failure = new Error("leaf detached");
      jest.mocked(openTurnDiff).mockRejectedValueOnce(failure);
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            parts: [{ kind: "thought", text: "Revise the note." }],
            turnStopReason: "end_turn",
            fileChanges: [FILE_CHANGE],
          }),
        ],
        false
      );

      fireEvent.click(screen.getByRole("button", { name: FILE_CHANGE.path }));

      await waitFor(() =>
        expect(logError).toHaveBeenCalledWith(
          "[AgentChatMessages] failed to open the turn diff",
          failure
        )
      );
    });

    it("shows questions before permissions and reveals a permission after questions clear for https://github.com/logancyang/obsidian-copilot/issues/2948", () => {
      const { rerender, props } = renderMessages([assistantMessage("answer-1", 62_000)], false, {
        pendingToolPermissions: [permission("permission-first"), permission("permission-second")],
        pendingAskUserQuestions: [question("question-first")],
      });

      const rail = screen.getByRole("region", { name: "Pending actions" });
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

    it("passes the pending permission the tool name its chat tool call shows for https://github.com/Brevilabs/obsidian-copilot-private/issues/599", () => {
      const toolTurn = assistantMessage("answer-1", 62_000, {
        parts: [
          { kind: "tool_call", id: "search-1", title: "websearch", status: "pending" },
        ] as AgentChatMessage["parts"],
      });

      renderMessages([toolTurn], true, {
        pendingToolPermissions: [permission("search-1")],
      });

      expect(screen.getByRole("region", { name: "Pending actions" }).textContent).toBe(
        "Permission search-1 via websearch"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/857 names a connector tool's permission request by its service and readable tool name", () => {
      const toolTurn = assistantMessage("answer-1", 62_000, {
        parts: [
          {
            kind: "tool_call",
            id: "create-1",
            title: "notion_create_page",
            status: "pending",
            mcpServer: "obsidian-copilot",
            vendorToolName: "notion_create_page",
            copilotTools: directCopilotToolUse("obsidian-copilot", "notion_create_page", {}),
          },
        ] as AgentChatMessage["parts"],
      });
      const request = permission("create-1");
      request.toolCall.title = "notion_create_page";

      renderMessages([toolTurn], true, { pendingToolPermissions: [request] });

      const rail = screen.getByRole("region", { name: "Pending actions" });
      expect(rail.textContent).toBe("Permission create-1");
      expect(screen.getByTitle("Notion · Create page")).toBeTruthy();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/875 names a direct OpenCode MCP permission after its connector tool", () => {
      const name = "obsidian-copilot_notion_create_page";
      const args = { title: "Orion" };
      const toolTurn = assistantMessage("answer-1", 62_000, {
        parts: [
          {
            kind: "tool_call",
            id: "direct-1",
            title: name,
            status: "in_progress",
            toolKind: "other",
            input: args,
            copilotTools: readOpencodeCopilotTools(args, name) ?? undefined,
          },
        ],
      });
      const request = permission("direct-1");
      request.toolCall.title = name;
      request.toolCall.rawInput = args;
      renderMessages([toolTurn], true, { pendingToolPermissions: [request] });
      expect(screen.getByRole("region", { name: "Pending actions" }).textContent).toBe(
        "Permission direct-1"
      );
      expect(screen.getByTitle("Notion · Create page")).toBeTruthy();
    });

    it("labels a permission request with the task that asked (https://github.com/Brevilabs/obsidian-copilot-private/issues/749)", () => {
      const request = { ...permission("sub-bash"), requester: { taskId: "task-1" } };

      render(
        <AgentTasksProvider tasks={[makeTask()]} openTask={jest.fn()}>
          <AgentChatMessages
            messages={[]}
            plugin={{ app: {}, manifest: { version: "4.1.0" } } as never}
            currentPlan={null}
            pendingToolPermissions={[request]}
            pendingAskUserQuestions={[]}
            chatBackend={chatBackend}
            isLoading={false}
            chatStates={EMPTY_CHAT_STATES}
          />
        </AgentTasksProvider>
      );

      expect(screen.getByRole("region", { name: "Pending actions" }).textContent).toBe(
        'Permission sub-bash from general-purpose "Count words in Welcome"'
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/946 labels a permission request from an @-mentioned agent with that agent's face and name", () => {
      const request = {
        ...permission("leo-edit"),
        requester: { agent: { slug: "leo", name: "Leo", faceSrc: "data:image/webp;base64,leo" } },
      };

      renderMessages([], true, { pendingToolPermissions: [request] });

      const rail = screen.getByRole("region", { name: "Pending actions" });
      expect(rail.textContent).toBe("Permission leo-edit from Leo");
      expect(rail.querySelector("img")?.getAttribute("src")).toBe("data:image/webp;base64,leo");
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

    describe("a reply relayed from an @-mentioned agent", () => {
      const relayed = formatAgentReply({
        agent: "maya",
        name: "Maya",
        mention: "mention-1",
        reply: "BIGGEST RISK: the intro is too slow.",
        changed: ["Plans/Launch plan.md"],
      });
      const relayMessage = {
        id: "relay",
        sender: USER_SENDER,
        message: relayed,
        timestamp: { epoch: 1, display: "", fileName: "" },
        isVisible: true,
        fileChanges: [
          {
            path: "Plans/Launch plan.md",
            status: "modified" as const,
            before: "a\n",
            after: "a\nb\n",
            additions: 1,
            deletions: 0,
          },
        ],
      };

      afterEach(async () => {
        await setCustomAgentsAccess("free");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 keeps a reply, another agent's message and a second reply in one response, with one row at its end that copies both replies' text in order without the other agent's message and adds up both turns in Worked for", async () => {
        await setCustomAgentsAccess("team");
        const messages = [
          assistantMessage("user-1", 1, { sender: USER_SENDER, message: "Ask Maya to check it" }),
          assistantMessage("reply-a", 2, {
            parts: [{ kind: "text", text: "I asked Maya." }],
            turnDurationMs: 46_000,
          }),
          relayMessage,
          assistantMessage("reply-b", 4, {
            parts: [{ kind: "text", text: "Maya found one wrong year." }],
            turnDurationMs: 12_000,
          }),
        ];

        render(
          <AppContext.Provider value={{} as App}>
            <AgentChatMessages {...messagesProps(messages, false)} />
          </AppContext.Provider>
        );

        const replies = screen.getAllByTestId("agent-trail-timestamp");
        expect(rowsOf(replies)).toEqual([
          ["none", undefined, undefined],
          ["shown", "I asked Maya.\n\nMaya found one wrong year.", "58000"],
        ]);
        const response = replies[0].closest(".tw-group\\/response");
        expect(response?.contains(replies[1])).toBe(true);
        expect(response?.textContent).toContain("Message fromMaya");
        expect(response?.contains(screen.getByTestId("single-message"))).toBe(false);
      });

      it("draws a relay as a card from the asked agent with the files it changed, never showing the message the current agent received (https://github.com/Brevilabs/obsidian-copilot-private/issues/967)", async () => {
        await setCustomAgentsAccess("team");

        const { container } = render(
          <AppContext.Provider value={{} as App}>
            <AgentChatMessages {...messagesProps([relayMessage], false)} />
          </AppContext.Provider>
        );

        expect(screen.getByRole("button", { name: "Plans/Launch plan.md" })).toBeTruthy();
        expect(container.textContent).toContain("Message fromMaya");
        expect(container.textContent).not.toContain("BIGGEST RISK");
        expect(container.textContent).not.toContain("copilot-teammate-reply");
        expect(container.textContent).not.toContain("Pass the reply on");
      });

      it("shows the rule the asked agent saved under its card beside the files it changed (https://github.com/Brevilabs/obsidian-copilot-private/issues/969)", async () => {
        await setCustomAgentsAccess("team");
        const memoryPath = "copilot/teammates/maya/MEMORY.md";
        const saved = {
          ...relayMessage,
          memorySaves: [{ agentName: "Maya", memoryPath, rule: "Flag video length first." }],
        };

        const { container } = render(
          <AppContext.Provider value={{} as App}>
            <AgentChatMessages {...messagesProps([saved], false)} />
          </AppContext.Provider>
        );

        const text = container.textContent ?? "";
        expect(text.indexOf("Message fromMaya")).toBe(0);
        expect(text).toContain("Maya remembered“Flag video length first.”");
        expect(screen.getByRole("button", { name: "Plans/Launch plan.md" })).toBeTruthy();
        expect(screen.getByRole("button", { name: /^Maya remembered/ })).toBeTruthy();
      });

      it("draws a relay as a card while a stored license is still being verified, so a restart never shows the message the current agent received (https://github.com/Brevilabs/obsidian-copilot-private/issues/951)", async () => {
        await setCustomAgentsAccess("unverified");

        const { container } = render(
          <AppContext.Provider value={{} as App}>
            <AgentChatMessages {...messagesProps([relayMessage], false)} />
          </AppContext.Provider>
        );

        expect(container.textContent).toContain("Message fromMaya");
        expect(container.textContent).not.toContain("BIGGEST RISK");
      });

      it("draws nothing under the message that asked, whatever its agent's run says (https://github.com/Brevilabs/obsidian-copilot-private/issues/967)", async () => {
        await setCustomAgentsAccess("team");
        const asked = assistantMessage("asked", 0, {
          sender: USER_SENDER,
          message: "@Maya what do you think of this plan?",
          agentMentions: [
            { id: "mention-1", agent: "maya", name: "Maya", status: "working", startedAt: 0 },
          ],
        });

        const { container } = render(
          <AppContext.Provider value={{} as App}>
            <AgentChatMessages {...messagesProps([asked], false)} />
          </AppContext.Provider>
        );

        expect(container.textContent).not.toContain("Maya is working");
        expect(screen.queryByRole("link")).toBeNull();
      });
    });

    describe("a custom agent's saved rules", () => {
      const MEMORY = "copilot/teammates/coco/MEMORY.md";
      const memorySaves = [
        { agentName: "Coco", memoryPath: MEMORY, rule: "Lead with user value." },
      ];
      const saveCall = {
        kind: "tool_call" as const,
        id: "save",
        title: "save_memory",
        status: "completed" as const,
        mcpServer: "obsidian-copilot",
        copilotTools: { calls: [{ name: "save_memory", args: { rule: "Lead with user value." } }] },
      };

      afterEach(async () => {
        await setCustomAgentsAccess("free");
      });

      it("hands the trail the saves to show in place of the save_memory call that made them (https://github.com/Brevilabs/obsidian-copilot-private/issues/988)", async () => {
        await setCustomAgentsAccess("team");

        renderMessages([assistantMessage("reply", 1, { parts: [saveCall], memorySaves })], false);

        expect(screen.getByTestId("agent-trail-memory-anchor").textContent).toBe("save");
        expect(screen.queryByText("Coco remembered")).toBeNull();
      });

      it("shows the saves above a reply opened from its note, which has no edit to stand in for (https://github.com/Brevilabs/obsidian-copilot-private/issues/942)", async () => {
        await setCustomAgentsAccess("team");

        const { container } = renderMessages(
          [assistantMessage("reply", 1, { message: "Got it.", memorySaves })],
          false
        );

        const text = container.textContent ?? "";
        expect(text.indexOf("Coco remembered")).toBeGreaterThan(-1);
        expect(text.indexOf("Coco remembered")).toBeLessThan(text.indexOf("Got it."));
      });

      it("lists an edit of MEMORY.md among the reply's changed files, with its diff and Undo, beside the save lines, since only an edit the user approved lands there (https://github.com/Brevilabs/obsidian-copilot-private/issues/988)", async () => {
        await setCustomAgentsAccess("team");
        const fileChanges = [MEMORY, "notes/plan.md"].map((path) => ({
          path,
          status: "created" as const,
          before: null,
          after: "x",
          additions: 1,
          deletions: 0,
        }));

        renderMessages(
          [assistantMessage("reply", 1, { parts: [saveCall], memorySaves, fileChanges })],
          false
        );

        expect(screen.getByRole("button", { name: "notes/plan.md" })).toBeTruthy();
        expect(screen.getByRole("button", { name: MEMORY })).toBeTruthy();
      });
    });
  });
});
