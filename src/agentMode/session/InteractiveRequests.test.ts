import { AI_SENDER } from "@/constants";
import { AgentMessageStore } from "./AgentMessageStore";
import { InteractiveRequests, type InteractiveRequestsDeps } from "./InteractiveRequests";
import { planPermissionRequest, writePermissionRequest } from "./testing/permissionPrompts";
import type { AgentPlanEntry, AskUserQuestionPrompt } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makeRequests(overrides: Partial<InteractiveRequestsDeps> = {}) {
  const mocks = {
    recomputeStatus: jest.fn(),
    notifyMessages: jest.fn(),
    notifyPlanChanged: jest.fn(),
    notifyTodoListChanged: jest.fn(),
  };
  const requests = new InteractiveRequests({
    store: new AgentMessageStore(),
    internalId: "internal-1",
    getReplyId: () => null,
    hasLeftPlanMode: () => false,
    ...mocks,
    ...overrides,
  });
  return { requests, ...mocks };
}

function addReply(store: AgentMessageStore): string {
  return store.addMessage({
    message: "",
    sender: AI_SENDER,
    timestamp: null,
    isVisible: true,
    parts: [],
  });
}

function fruitQuestion(overrides: Partial<AskUserQuestionPrompt> = {}): AskUserQuestionPrompt {
  return {
    sessionId: "acp-1",
    requestId: "tc-ask",
    questions: [{ question: "Pick a fruit", options: [{ label: "Apple" }, { label: "Pear" }] }],
    ...overrides,
  };
}

const PLAN_INFO = { plan: "# Ship it\n\n1. step" };

describe("InteractiveRequests", () => {
  describe("InteractiveRequests", () => {
    describe("handlePlanProposalPermission()", () => {
      it("publishes a gated plan from an ExitPlanMode permission request", async () => {
        const { requests } = makeRequests();

        const decisionPromise = requests.handlePlanProposalPermission(
          planPermissionRequest("tc-plan-from-permission", {
            plan: "# permission plan body",
            planFilePath: "/Users/test/.claude/plans/plan.md",
          })
        );

        const plan = requests.getCurrentPlan();
        expect(plan?.body).toBe("# permission plan body");
        expect(plan?.permissionGated).toBe(true);
        expect(plan?.pendingToolCallId).toBe("tc-plan-from-permission");
        expect(plan?.sourceFilePath).toBe("/Users/test/.claude/plans/plan.md");

        requests.resolvePlanProposalPermission("tc-plan-from-permission", false);
        await decisionPromise;
      });

      it("holds the request as pending, then recomputes the status and notifies the transcript", () => {
        const { requests, recomputeStatus, notifyMessages } = makeRequests();

        void requests.handlePlanProposalPermission(planPermissionRequest("tc-plan", PLAN_INFO));

        expect(requests.hasPendingPlanPermission()).toBe(true);
        expect(recomputeStatus).toHaveBeenCalled();
        expect(notifyMessages).toHaveBeenCalled();
      });
    });

    describe("resolvePlanProposalPermission()", () => {
      it("resolves with a reject option and the deny message when the plan is denied with feedback", async () => {
        const { requests } = makeRequests();
        const decisionPromise = requests.handlePlanProposalPermission(
          planPermissionRequest("tc-plan-deny-msg", { plan: "# x" })
        );

        requests.resolvePlanProposalPermission("tc-plan-deny-msg", false, "please drop step 2");
        const decision = await decisionPromise;

        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
        expect(decision.denyMessage).toBe("please drop step 2");
      });

      it("resolves with the allow option and no deny message when the plan is approved", async () => {
        const { requests } = makeRequests();
        const decisionPromise = requests.handlePlanProposalPermission(
          planPermissionRequest("tc-plan-allow", { plan: "# x" })
        );

        requests.resolvePlanProposalPermission("tc-plan-allow", true, "should be ignored");
        const decision = await decisionPromise;

        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
        expect(decision.denyMessage).toBeUndefined();
      });

      it("ignores a tool call with no pending plan request", () => {
        const { requests, notifyMessages } = makeRequests();

        requests.resolvePlanProposalPermission("unknown", true);

        expect(notifyMessages).not.toHaveBeenCalled();
      });
    });

    describe("getCurrentPlan()", () => {
      it("starts with no plan", () => {
        expect(makeRequests().requests.getCurrentPlan()).toBeNull();
      });
    });

    describe("getCurrentTodoList()", () => {
      it("starts with no todo list", () => {
        expect(makeRequests().requests.getCurrentTodoList()).toBeNull();
      });
    });

    describe("hasPending()", () => {
      it("reports a pending plan proposal, tool permission or question until each is answered", () => {
        const { requests } = makeRequests();
        expect(requests.hasPending()).toBe(false);

        void requests.handlePlanProposalPermission(planPermissionRequest("tc-plan", PLAN_INFO));
        void requests.handleToolPermission(writePermissionRequest());
        void requests.handleAskUserQuestion(fruitQuestion());
        requests.resolvePlanProposalPermission("tc-plan", true);
        requests.resolveToolPermission("tc-write", "allow_once");
        expect(requests.hasPending()).toBe(true);

        requests.resolveAskUserQuestion("tc-ask", {});
        expect(requests.hasPending()).toBe(false);
      });
    });

    describe("finalizePlanDecision()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/41 records the decision on the plan's tool call and closes the plan", () => {
        const store = new AgentMessageStore();
        const replyId = addReply(store);
        const { requests, notifyPlanChanged } = makeRequests({
          store,
          getReplyId: () => replyId,
        });
        requests.publishGatedPlan("tc-plan", PLAN_INFO);
        const plan = requests.getCurrentPlan()!;

        expect(requests.finalizePlanDecision(plan.id, "feedback", "drop step 2")).toBe(true);

        expect(requests.getCurrentPlan()).toBeNull();
        expect(notifyPlanChanged).toHaveBeenCalledTimes(2);
        expect(store.getMessage(replyId)?.parts).toEqual([
          expect.objectContaining({
            kind: "tool_call",
            id: "tc-plan",
            status: "completed",
            userResponse: "Requested plan changes: drop step 2",
          }),
        ]);
      });

      it("refuses a decision for a plan that is no longer current", () => {
        const { requests } = makeRequests();
        requests.publishGatedPlan("tc-plan", PLAN_INFO);

        expect(requests.finalizePlanDecision("plan-other", "approve")).toBe(false);
        expect(requests.getCurrentPlan()).not.toBeNull();
      });

      it("keeps a decided plan closed when its tool call is reported again", () => {
        const { requests } = makeRequests();
        requests.publishGatedPlan("tc-plan", PLAN_INFO);
        requests.finalizePlanDecision(requests.getCurrentPlan()!.id, "approve");

        requests.publishGatedPlan("tc-plan", PLAN_INFO);

        expect(requests.getCurrentPlan()).toBeNull();
      });
    });

    describe("clearCurrentPlanIfModeLeft()", () => {
      it("denies the plan's pending request and closes the plan once the agent leaves plan mode", async () => {
        const { requests } = makeRequests({ hasLeftPlanMode: () => true });
        const decision = requests.handlePlanProposalPermission(
          planPermissionRequest("tc-plan", PLAN_INFO)
        );

        requests.clearCurrentPlanIfModeLeft();

        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
        expect(requests.getCurrentPlan()).toBeNull();
        requests.publishGatedPlan("tc-plan", PLAN_INFO);
        expect(requests.getCurrentPlan()).toBeNull();
      });

      it("keeps the plan while the agent is still in plan mode", () => {
        const { requests } = makeRequests({ hasLeftPlanMode: () => false });
        requests.publishGatedPlan("tc-plan", PLAN_INFO);

        requests.clearCurrentPlanIfModeLeft();

        expect(requests.getCurrentPlan()).not.toBeNull();
      });
    });

    describe("hasPendingPlanPermission()", () => {
      it("reports whether a plan proposal waits for the user's decision", () => {
        const { requests } = makeRequests();
        expect(requests.hasPendingPlanPermission()).toBe(false);

        void requests.handlePlanProposalPermission(planPermissionRequest("tc-plan", PLAN_INFO));
        expect(requests.hasPendingPlanPermission()).toBe(true);

        requests.resolvePlanProposalPermission("tc-plan", true);
        expect(requests.hasPendingPlanPermission()).toBe(false);
      });
    });

    describe("handleToolPermission()", () => {
      it("lists the request as pending, then recomputes the status and notifies the transcript", () => {
        const { requests, recomputeStatus, notifyMessages } = makeRequests();
        const request = writePermissionRequest();

        void requests.handleToolPermission(request);

        expect(requests.getPendingToolPermissions()).toEqual([request]);
        expect(recomputeStatus).toHaveBeenCalled();
        expect(notifyMessages).toHaveBeenCalled();
      });
    });

    describe("resolveToolPermission()", () => {
      it("resolves the request with the chosen option and drops it from the pending list", async () => {
        const { requests } = makeRequests();
        const decision = requests.handleToolPermission(writePermissionRequest());

        requests.resolveToolPermission("tc-write", "allow_once");

        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "allow_once" },
        });
        expect(requests.getPendingToolPermissions()).toHaveLength(0);
      });
    });

    describe("getPendingToolPermissions()", () => {
      it("returns the shared empty array when no tool permission is pending", () => {
        const { requests } = makeRequests();

        expect(requests.getPendingToolPermissions()).toHaveLength(0);
        expect(requests.getPendingToolPermissions()).toBe(requests.getPendingToolPermissions());
      });
    });

    describe("rejectToolRequestsFrom()", () => {
      it("rejects every pending main-agent tool permission and notifies the transcript", async () => {
        const { requests, notifyMessages } = makeRequests();
        const decision = requests.handleToolPermission(writePermissionRequest());
        notifyMessages.mockClear();

        requests.rejectToolRequestsFrom("main");

        await expect(decision).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
        expect(requests.getPendingToolPermissions()).toHaveLength(0);
        expect(notifyMessages).toHaveBeenCalledTimes(1);
      });

      it("does nothing when no tool permission is pending", () => {
        const { requests, notifyMessages } = makeRequests();

        requests.rejectToolRequestsFrom("main");

        expect(notifyMessages).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/748 rejects only the named task's pending tool permissions and keeps the main agent's and other tasks' requests", async () => {
        const { requests } = makeRequests();
        const fromTask = (taskId: string) => ({
          ...writePermissionRequest(),
          requester: { taskId },
          toolCall: { ...writePermissionRequest().toolCall, toolCallId: `tc-${taskId}` },
        });
        void requests.handleToolPermission(writePermissionRequest());
        const ended = requests.handleToolPermission(fromTask("task-1"));
        void requests.handleToolPermission(fromTask("task-2"));

        requests.rejectToolRequestsFrom({ taskId: "task-1" });

        await expect(ended).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
        expect(requests.getPendingToolPermissions().map((p) => p.toolCall.toolCallId)).toEqual([
          "tc-write",
          "tc-task-2",
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/175 keeps a background task's tool permission pending and answerable", async () => {
        const { requests, notifyMessages } = makeRequests();
        const fromTask = requests.handleToolPermission({
          ...writePermissionRequest(),
          requester: { taskId: "task-1" },
          toolCall: { ...writePermissionRequest().toolCall, toolCallId: "tc-task" },
        });
        notifyMessages.mockClear();

        requests.rejectToolRequestsFrom("main");

        expect(notifyMessages).not.toHaveBeenCalled();
        expect(requests.getPendingToolPermissions().map((p) => p.toolCall.toolCallId)).toEqual([
          "tc-task",
        ]);
        requests.resolveToolPermission("tc-task", "allow_once");
        await expect(fromTask).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "allow_once" },
        });
      });
    });

    describe("handleAskUserQuestion()", () => {
      it("withdraws an ACP question when its request signal aborts (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
        const { requests } = makeRequests();
        const controller = new AbortController();
        const answers = requests.handleAskUserQuestion({
          sessionId: "acp-1",
          requestId: "rpc-1",
          questions: [
            { question: "Approach", answerKey: "approach", options: [{ label: "Simple" }] },
          ],
          signal: controller.signal,
        });
        expect(requests.getPendingAskUserQuestions()).toHaveLength(1);
        controller.abort();
        await expect(answers).resolves.toEqual({});
        expect(requests.getPendingAskUserQuestions()).toHaveLength(0);
        requests.resolveAskUserQuestion("rpc-1", { approach: "Simple" });
        expect(requests.getPendingAskUserQuestions()).toHaveLength(0);
      });

      it("answers a question whose signal already aborted with no answers, without listing it", async () => {
        const { requests } = makeRequests();
        const controller = new AbortController();
        controller.abort();

        await expect(
          requests.handleAskUserQuestion(fruitQuestion({ signal: controller.signal }))
        ).resolves.toEqual({});
        expect(requests.getPendingAskUserQuestions()).toHaveLength(0);
      });
    });

    describe("resolveAskUserQuestion()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 resolves with the answers and records them in the current reply", async () => {
        const store = new AgentMessageStore();
        const replyId = addReply(store);
        const { requests } = makeRequests({ store, getReplyId: () => replyId });
        const answers = requests.handleAskUserQuestion(fruitQuestion());

        requests.resolveAskUserQuestion("tc-ask", { "Pick a fruit": "Pear" });

        await expect(answers).resolves.toEqual({ "Pick a fruit": "Pear" });
        expect(store.getMessage(replyId)?.parts).toEqual([
          expect.objectContaining({
            id: "tc-ask",
            userResponse: "Answered: Pear",
            output: [{ type: "text", text: "Pick a fruit: Pear" }],
          }),
        ]);
      });
    });

    describe("getPendingAskUserQuestions()", () => {
      it("returns the shared empty array when no AskUserQuestion is pending", () => {
        const { requests } = makeRequests();
        expect(requests.getPendingAskUserQuestions()).toHaveLength(0);
        expect(requests.getPendingAskUserQuestions()).toBe(requests.getPendingAskUserQuestions());
      });
    });

    describe("withdrawQuestions()", () => {
      it("answers every pending question with no answers and notifies the transcript", async () => {
        const { requests, notifyMessages } = makeRequests();
        const answers = requests.handleAskUserQuestion(fruitQuestion());
        notifyMessages.mockClear();

        requests.withdrawQuestions();

        await expect(answers).resolves.toEqual({});
        expect(requests.getPendingAskUserQuestions()).toHaveLength(0);
        expect(notifyMessages).toHaveBeenCalledTimes(1);
      });

      it("does nothing when no question is pending", () => {
        const { requests, notifyMessages } = makeRequests();

        requests.withdrawQuestions();

        expect(notifyMessages).not.toHaveBeenCalled();
      });
    });

    describe("publishGatedPlan()", () => {
      it("keeps the plan revision but tracks the new pending tool call when an identical plan body is proposed again", () => {
        const { requests } = makeRequests();
        const planBody = "# proposed plan body";

        requests.publishGatedPlan("tc-plan-A", { plan: planBody });
        const first = requests.getCurrentPlan();
        expect(first?.pendingToolCallId).toBe("tc-plan-A");
        expect(first?.permissionGated).toBe(true);
        expect(first?.revision).toBe(1);

        requests.publishGatedPlan("tc-plan-B", { plan: planBody });
        const second = requests.getCurrentPlan();
        expect(second?.pendingToolCallId).toBe("tc-plan-B");
        expect(second?.permissionGated).toBe(true);
        expect(second?.revision).toBe(1);
      });

      it("titles a new plan from its markdown and bumps the revision when its body changes", () => {
        const { requests, notifyPlanChanged } = makeRequests();

        requests.publishGatedPlan("tc-plan", PLAN_INFO);
        requests.publishGatedPlan("tc-plan", PLAN_INFO);
        requests.publishGatedPlan("tc-plan", { plan: "# Ship it\n\n1. step\n2. more" });

        expect(requests.getCurrentPlan()).toMatchObject({
          id: "plan-internal-1-1",
          title: "Ship it",
          revision: 2,
          decision: "pending",
        });
        expect(notifyPlanChanged).toHaveBeenCalledTimes(2);
      });

      it("denies the earlier proposal's pending request when a new tool call proposes a plan", async () => {
        const { requests } = makeRequests();
        const stale = requests.handlePlanProposalPermission(
          planPermissionRequest("tc-plan-A", PLAN_INFO)
        );

        requests.publishGatedPlan("tc-plan-B", PLAN_INFO);

        await expect(stale).resolves.toEqual({
          outcome: { outcome: "selected", optionId: "reject_once" },
        });
      });
    });

    describe("applyTodoList()", () => {
      const entries = (...contents: string[]): AgentPlanEntry[] =>
        contents.map((content) => ({ content, status: "pending", priority: "medium" }));

      it("snapshots the entries' content and status and notifies the todo-list channel", () => {
        const { requests, notifyTodoListChanged } = makeRequests();

        requests.applyTodoList(entries("step A", "step B"));

        expect(requests.getCurrentTodoList()).toEqual([
          { content: "step A", status: "pending" },
          { content: "step B", status: "pending" },
        ]);
        expect(notifyTodoListChanged).toHaveBeenCalledTimes(1);
      });

      it("dedupes identical lists (synthesized + real plan channel) by content signature", () => {
        const { requests, notifyTodoListChanged } = makeRequests();
        requests.applyTodoList([{ content: "same", status: "pending", priority: "high" }]);
        const snapshot = requests.getCurrentTodoList();

        requests.applyTodoList([{ content: "same", status: "pending", priority: "low" }]);

        expect(notifyTodoListChanged).toHaveBeenCalledTimes(1);
        expect(requests.getCurrentTodoList()).toBe(snapshot);
      });

      it("clears to null on an empty plan", () => {
        const { requests } = makeRequests();
        requests.applyTodoList(entries("only"));

        requests.applyTodoList([]);

        expect(requests.getCurrentTodoList()).toBeNull();
      });
    });

    describe("dispose()", () => {
      it("rejects pending permissions, withdraws questions, and clears the plan and todo list", async () => {
        const { requests } = makeRequests();
        const plan = requests.handlePlanProposalPermission(
          planPermissionRequest("tc-plan", PLAN_INFO)
        );
        const tool = requests.handleToolPermission(writePermissionRequest());
        const question = requests.handleAskUserQuestion(fruitQuestion());
        requests.applyTodoList([{ content: "again", status: "pending", priority: "medium" }]);

        requests.dispose();

        const rejected = { outcome: { outcome: "selected", optionId: "reject_once" } };
        await expect(plan).resolves.toEqual(rejected);
        await expect(tool).resolves.toEqual(rejected);
        await expect(question).resolves.toEqual({});
        expect(requests.hasPending()).toBe(false);
        expect(requests.getCurrentPlan()).toBeNull();
        expect(requests.getCurrentTodoList()).toBeNull();
      });
    });
  });
});
