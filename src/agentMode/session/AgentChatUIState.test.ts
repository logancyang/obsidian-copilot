import { waitFor } from "@testing-library/react";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendDescriptor } from "@/agentMode/session/descriptor";
import type {
  BackendProcess,
  PermissionPrompt,
  PromptInput,
  SessionEvent,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));

describe("AgentChatUIState", () => {
  function planReview(
    feedbackDelivery?: "permission" | "next_turn",
    { permissionArrived = true }: { permissionArrived?: boolean } = {}
  ) {
    let emitUpdate: SessionUpdateHandler | undefined;
    let finishFirstTurn: ((result: { stopReason: "end_turn" }) => void) | undefined;
    let failFirstTurn: ((error: Error) => void) | undefined;
    const prompt = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finishFirstTurn = resolve;
            failFirstTurn = reject;
          })
      )
      .mockResolvedValue({ stopReason: "end_turn" });
    const backend = {
      isRunning: () => true,
      onExit: () => () => undefined,
      registerSessionHandler: (_id: string, handler: SessionUpdateHandler) => {
        emitUpdate = handler;
        return () => undefined;
      },
      prompt: async (input: PromptInput) => {
        const emit = (update: SessionEvent["update"]) =>
          emitUpdate!({ sessionId: "codex-session", update });
        emit({ sessionUpdate: "message_delivered", promptId: input.promptId });
        emit({ sessionUpdate: "turn_started", turnId: input.promptId });
        void prompt(input).then(
          (outcome: { stopReason: "end_turn" }) =>
            emit({ sessionUpdate: "turn_ended", turnId: input.promptId, ...outcome }),
          (error: Error) =>
            emit({
              sessionUpdate: "turn_ended",
              turnId: input.promptId,
              stopReason: "end_turn",
              error,
            })
        );
      },
    } as unknown as BackendProcess;
    const descriptor = { planFeedbackDelivery: feedbackDelivery } as unknown as BackendDescriptor;
    const session = new AgentSession({
      backend,
      backendSessionId: "codex-session",
      internalId: "plan-review",
      backendId: "codex",
      getDescriptor: () => descriptor,
    });
    session.completeResume({
      model: null,
      mode: {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: {},
      },
    });
    const chat = new AgentChatUIState(session);
    const firstTurn = chat.sendMessage("Draft a plan").turn;
    const request: PermissionPrompt = {
      sessionId: "codex-session",
      toolCall: {
        toolCallId: "plan-review-tool",
        title: "Implement this plan?",
        kind: "switch_mode",
        status: "pending",
        rawInput: { plan: "# Draft plan" },
        isPlanProposal: true,
      },
      options: [
        { optionId: "implement_plan", name: "Implement", kind: "allow_once" },
        { optionId: "revise_plan", name: "Revise", kind: "reject_once" },
      ],
    };
    emitUpdate!({
      sessionId: "codex-session",
      update: { sessionUpdate: "tool_call", ...request.toolCall },
    });
    const permission = permissionArrived
      ? session.handlePlanProposalPermission(request)
      : new Promise<never>(() => undefined);
    const plan = chat.getCurrentPlan();
    if (!plan) throw new Error("Expected a pending plan");
    return {
      chat,
      session,
      plan,
      permission,
      request,
      prompt,
      firstTurn,
      finishFirstTurn: () => finishFirstTurn!({ stopReason: "end_turn" }),
      failFirstTurn: () => failFirstTurn!(new Error("ACP transport closed")),
    };
  }

  describe("resolvePlanProposal()", () => {
    it.each([
      ["approve", "Approved plan"],
      ["reject", "Rejected plan"],
      ["feedback", "Requested plan changes: revise step two"],
    ] as const)(
      "shows the user's %s decision in the transcript (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)",
      async (decision, expected) => {
        const review = planReview();
        await review.chat.resolvePlanProposal(review.plan.id, decision, "revise step two");
        const part = review.chat
          .getMessages()
          .flatMap((message) => message.parts ?? [])
          .find((item) => item.kind === "tool_call" && item.id === "plan-review-tool");
        expect(part?.kind).toBe("tool_call");
        if (part?.kind === "tool_call") {
          expect(lookupToolSummary(part).collapsedLine(part, { vaultBase: null })).toBe(expected);
        }
        review.finishFirstTurn();
        await review.firstTurn;
      }
    );
    it("sends Codex feedback as a visible follow-up after its plan permission ends the turn (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", async () => {
      const review = planReview("next_turn");
      const resolution = review.chat.resolvePlanProposal(
        review.plan.id,
        "feedback",
        "  save it to a note  "
      );

      expect(await review.permission).toEqual({
        outcome: { outcome: "selected", optionId: "revise_plan" },
      });
      expect(review.prompt).toHaveBeenCalledTimes(1);
      review.finishFirstTurn();
      await review.firstTurn;
      await resolution;

      expect(review.prompt).toHaveBeenCalledTimes(2);
      expect(review.prompt.mock.calls[1][0].prompt[0].text).toContain("save it to a note");
      expect(
        review.chat.getMessages().some((message) => message.message === "save it to a note")
      ).toBe(true);
    });

    it("keeps permission-message feedback in the original turn for adapters that consume it", async () => {
      const review = planReview();
      await review.chat.resolvePlanProposal(review.plan.id, "feedback", "revise step two");
      expect((await review.permission).denyMessage).toBe("revise step two");
      review.finishFirstTurn();
      await review.firstTurn;
      expect(review.prompt).toHaveBeenCalledTimes(1);
    });

    it("does not send Codex feedback when the permission turn fails before a follow-up can begin", async () => {
      const review = planReview("next_turn");
      const resolution = review.chat.resolvePlanProposal(review.plan.id, "feedback", "save it");
      await review.permission;
      review.failFirstTurn();

      await expect(resolution).rejects.toThrow("ACP transport closed");
      expect(review.prompt).toHaveBeenCalledTimes(1);
      expect(review.chat.getMessages().some((message) => message.message === "save it")).toBe(
        false
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 ignores a decision made before the plan permission arrives and keeps the card reviewable", async () => {
      const review = planReview("permission", { permissionArrived: false });
      await review.chat.resolvePlanProposal(review.plan.id, "approve");
      expect(review.chat.getCurrentPlan()?.id).toBe(review.plan.id);

      const permission = review.session.handlePlanProposalPermission(review.request);
      await review.chat.resolvePlanProposal(review.plan.id, "approve");
      expect((await permission).outcome).toEqual({
        outcome: "selected",
        optionId: "implement_plan",
      });
      review.finishFirstTurn();
      await review.firstTurn;
    });

    it.each(["approve", "reject"] as const)(
      "settles %s without starting a follow-up turn",
      async (decision) => {
        const review = planReview("next_turn");
        await review.chat.resolvePlanProposal(review.plan.id, decision);
        const permission = await review.permission;
        expect(permission.outcome).toEqual({
          outcome: "selected",
          optionId: decision === "approve" ? "implement_plan" : "revise_plan",
        });
        review.finishFirstTurn();
        await review.firstTurn;
        expect(review.prompt).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe("resolveAskUserQuestion()", () => {
    it("shows the selected answer in the transcript (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
      const review = planReview();
      const answer = review.session.handleAskUserQuestion({
        sessionId: "codex-session",
        requestId: "question-one",
        questions: [{ question: "Format: choose one", options: [{ label: "Checklist" }] }],
      });
      review.chat.resolveAskUserQuestion("question-one", { "Format: choose one": "Checklist" });
      await answer;
      const part = review.chat
        .getMessages()
        .flatMap((message) => message.parts ?? [])
        .find((item) => item.kind === "tool_call" && item.id === "question-one");
      expect(part?.kind).toBe("tool_call");
      if (part?.kind === "tool_call") {
        expect(lookupToolSummary(part).collapsedLine(part, { vaultBase: null })).toBe(
          "Answered: Checklist"
        );
      }
      review.finishFirstTurn();
      await review.firstTurn;
    });
  });

  function feedbackChat(): AgentChatUIState {
    const session = new AgentSession({
      backend: {
        isRunning: () => true,
        onExit: () => () => undefined,
        registerSessionHandler: () => () => undefined,
      } as unknown as BackendProcess,
      backendSessionId: "s-1",
      internalId: "feedback",
      backendId: "claude",
    });
    session.completeResume(null);
    const chat = new AgentChatUIState(session);
    session.offerFeedback({ title: "t", whatHappened: "w", userSaid: "", repro: "r" });
    return chat;
  }

  describe("getFeedbackOffer()", () => {
    it("serves the session's open feedback card", () => {
      expect(feedbackChat().getFeedbackOffer()?.status).toBe("open");
    });
  });

  describe("dismissFeedbackOffer()", () => {
    it("dismisses the session's open card and notifies the view", () => {
      const chat = feedbackChat();
      const listener = jest.fn();
      chat.subscribe(listener);

      chat.dismissFeedbackOffer();

      expect(chat.getFeedbackOffer()?.status).toBe("dismissed");
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("markFeedbackReported()", () => {
    it("records the sent report on the session's card", () => {
      const chat = feedbackChat();

      chat.markFeedbackReported({ reportId: "r1", issueUrl: "https://example.com" });

      expect(chat.getFeedbackOffer()).toMatchObject({
        status: "reported",
        report: { reportId: "r1", issueUrl: "https://example.com" },
      });
    });
  });

  describe("isTurnInFlight()", () => {
    it("stays true while an approved plan is being implemented and clears when the turn finishes (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", async () => {
      const review = planReview("next_turn");
      expect(review.chat.isTurnInFlight()).toBe(true);

      await review.chat.resolvePlanProposal(review.plan.id, "approve");
      await review.permission;
      expect(review.chat.isTurnInFlight()).toBe(true);

      review.finishFirstTurn();
      await review.firstTurn;
      expect(review.chat.isTurnInFlight()).toBe(false);
    });
  });

  function liveChat(descriptor: Partial<BackendDescriptor>, extra: Partial<BackendProcess> = {}) {
    let handler: SessionUpdateHandler | undefined;
    const backend = {
      isRunning: () => true,
      onExit: () => () => undefined,
      registerSessionHandler: (_id: string, h: SessionUpdateHandler) => {
        handler = h;
        return () => undefined;
      },
      prompt: async () => undefined,
      ...extra,
    } as unknown as BackendProcess;
    const session = new AgentSession({
      backend,
      backendSessionId: "claude-session",
      internalId: "live",
      backendId: "claude",
      getDescriptor: () => descriptor as BackendDescriptor,
    });
    session.completeResume(null);
    const chat = new AgentChatUIState(session);
    const emit = (update: SessionEvent["update"], taskToolCallId?: string) =>
      handler!({ sessionId: "claude-session", update, taskToolCallId });
    return Object.assign(chat, { emit });
  }

  describe("acceptsMidTurnMessages()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 follows the backend's mid-turn delivery capability", () => {
      expect(liveChat({ midTurnDelivery: true }).acceptsMidTurnMessages()).toBe(true);
      expect(liveChat({}).acceptsMidTurnMessages()).toBe(false);
    });
  });

  describe("getQueuedPrompts()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/509 lists a message sent while the agent works, and notifies the composer when the agent withdraws it", () => {
      const chat = liveChat({ midTurnDelivery: true });
      chat.sendMessage("list the notes");
      const { id } = chat.sendMessage("only the first two");
      expect(chat.getQueuedPrompts()).toEqual([
        expect.objectContaining({ id, text: "only the first two" }),
      ]);
      const listener = jest.fn();
      chat.subscribe(listener);

      chat.emit({ sessionUpdate: "messages_withdrawn", promptIds: [id] });

      expect(chat.getQueuedPrompts()).toEqual([]);
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("canWithdrawMessages()", () => {
    it("follows the backend's withdraw capability (https://github.com/Brevilabs/obsidian-copilot-private/issues/747)", () => {
      expect(liveChat({ withdraw: true }).canWithdrawMessages()).toBe(true);
      expect(liveChat({}).canWithdrawMessages()).toBe(false);
    });
  });

  describe("withdrawMessage()", () => {
    it("asks the backend to withdraw a queued message (https://github.com/Brevilabs/obsidian-copilot-private/issues/747)", async () => {
      const withdraw = jest.fn(async () => false);
      const prompt = jest.fn(async () => undefined);
      const chat = liveChat({ midTurnDelivery: true, withdraw: true }, { prompt, withdraw });
      chat.sendMessage("list the notes");
      const { id } = chat.sendMessage("only the first two");
      await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));

      await chat.withdrawMessage(id);

      expect(withdraw).toHaveBeenCalledWith({ sessionId: "claude-session", promptId: id });
    });
  });

  describe("takeWithdrawnPrompts()", () => {
    it("hands over the messages the agent withdrew, once (https://github.com/Brevilabs/obsidian-copilot-private/issues/747)", () => {
      const chat = liveChat({ midTurnDelivery: true });
      chat.sendMessage("list the notes");
      const { id } = chat.sendMessage("only the first two");

      chat.emit({ sessionUpdate: "messages_withdrawn", promptIds: [id] });

      expect(chat.takeWithdrawnPrompts().map((p) => p.text)).toEqual(["only the first two"]);
      expect(chat.takeWithdrawnPrompts()).toEqual([]);
    });
  });

  describe("getTasks()", () => {
    it("lists the session's tasks and notifies the UI when one starts (https://github.com/Brevilabs/obsidian-copilot-private/issues/749)", () => {
      const chat = liveChat({});
      const listener = jest.fn();
      chat.subscribe(listener);

      chat.emit({
        sessionUpdate: "task_started",
        taskId: "task-1",
        toolCallId: "call-1",
        kind: "command",
        description: "Render the video",
      });

      expect(chat.getTasks()).toEqual([
        expect.objectContaining({ taskId: "task-1", kind: "command", status: "running" }),
      ]);
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("getTaskMessages()", () => {
    it("returns a task's own messages and notifies the UI as they grow (https://github.com/Brevilabs/obsidian-copilot-private/issues/749)", () => {
      const chat = liveChat({});
      chat.emit({
        sessionUpdate: "task_started",
        taskId: "task-1",
        toolCallId: "call-1",
        kind: "subagent",
        description: "Count words",
      });
      const listener = jest.fn();
      chat.subscribe(listener);

      chat.emit(
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "9 words." } },
        "call-1"
      );

      expect(chat.getTaskMessages("call-1")[0].parts).toEqual([{ kind: "text", text: "9 words." }]);
      expect(chat.getMessages()).toEqual([]);
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("canStopTasks()", () => {
    it("follows the backend's per-task stop capability (https://github.com/Brevilabs/obsidian-copilot-private/issues/748)", () => {
      expect(liveChat({ stopTask: true }).canStopTasks()).toBe(true);
      expect(liveChat({}).canStopTasks()).toBe(false);
    });
  });

  describe("stopTask()", () => {
    it("asks the backend to stop the task with that id (https://github.com/Brevilabs/obsidian-copilot-private/issues/748)", async () => {
      const stopTask = jest.fn(async () => undefined);
      const chat = liveChat({ stopTask: true }, { stopTask });

      await chat.stopTask("task-1");

      expect(stopTask).toHaveBeenCalledWith({ sessionId: "claude-session", taskId: "task-1" });
    });
  });
});
