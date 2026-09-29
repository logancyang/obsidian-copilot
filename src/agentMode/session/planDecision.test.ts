import { AgentSession } from "@/agentMode/session/AgentSession";
import { applyPlanDecision, findDecidablePlan } from "@/agentMode/session/planDecision";
import type { BackendDescriptor } from "@/agentMode/session/descriptor";
import type {
  BackendProcess,
  PermissionPrompt,
  PlanDecisionAction,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));

describe("planDecision", () => {
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
      prompt,
    } as unknown as BackendProcess;
    const descriptor = { planFeedbackDelivery: feedbackDelivery } as unknown as BackendDescriptor;
    const session = new AgentSession({
      backend,
      backendSessionId: "codex-session",
      internalId: "plan-review",
      backendId: "codex",
      initialState: {
        model: null,
        mode: {
          current: "plan",
          options: [{ value: "plan", label: "Plan" }],
          apply: {},
        },
      },
      getDescriptor: () => descriptor,
    });
    const firstTurn = session.sendPrompt("Draft a plan").turn;
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
    const plan = session.getCurrentPlan();
    if (!plan) throw new Error("Expected a pending plan");
    const decide = (decision: PlanDecisionAction, feedback?: string) => {
      const decidable = findDecidablePlan(session, plan.id);
      if (!decidable) return Promise.resolve();
      return applyPlanDecision(session, decidable, decision, feedback);
    };
    return {
      decide,
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

  describe("findDecidablePlan()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 finds no plan before the plan permission arrives and finds it once it has", async () => {
      const review = planReview("permission", { permissionArrived: false });
      expect(findDecidablePlan(review.session, review.plan.id)).toBeNull();
      expect(review.session.getCurrentPlan()?.id).toBe(review.plan.id);

      const permission = review.session.handlePlanProposalPermission(review.request);
      const plan = findDecidablePlan(review.session, review.plan.id);
      expect(plan?.pendingToolCallId).toBe("plan-review-tool");
      await applyPlanDecision(review.session, plan!, "approve");
      expect((await permission).outcome).toEqual({
        outcome: "selected",
        optionId: "implement_plan",
      });
      review.finishFirstTurn();
      await review.firstTurn;
    });

    it("finds no plan for an unknown proposal id or one that is already decided", async () => {
      const review = planReview();
      expect(findDecidablePlan(review.session, "other-proposal")).toBeNull();

      await review.decide("approve");
      expect(findDecidablePlan(review.session, review.plan.id)).toBeNull();
      review.finishFirstTurn();
      await review.firstTurn;
    });
  });

  describe("applyPlanDecision()", () => {
    it.each([
      ["approve", "Approved plan"],
      ["reject", "Rejected plan"],
      ["feedback", "Requested plan changes: revise step two"],
    ] as const)(
      "shows the user's %s decision in the transcript (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)",
      async (decision, expected) => {
        const review = planReview();
        await review.decide(decision, "revise step two");
        const part = review.session.store
          .getDisplayMessages()
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
      const resolution = review.decide("feedback", "  save it to a note  ");

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
        review.session.store
          .getDisplayMessages()
          .some((message) => message.message === "save it to a note")
      ).toBe(true);
    });

    it("keeps permission-message feedback in the original turn for adapters that consume it", async () => {
      const review = planReview();
      await review.decide("feedback", "revise step two");
      expect((await review.permission).denyMessage).toBe("revise step two");
      review.finishFirstTurn();
      await review.firstTurn;
      expect(review.prompt).toHaveBeenCalledTimes(1);
    });

    it("does not send Codex feedback when the permission turn fails before a follow-up can begin", async () => {
      const review = planReview("next_turn");
      const resolution = review.decide("feedback", "save it");
      await review.permission;
      review.failFirstTurn();

      await expect(resolution).rejects.toThrow("ACP transport closed");
      expect(review.prompt).toHaveBeenCalledTimes(1);
      expect(
        review.session.store.getDisplayMessages().some((message) => message.message === "save it")
      ).toBe(false);
    });

    it.each(["approve", "reject"] as const)(
      "settles %s without starting a follow-up turn",
      async (decision) => {
        const review = planReview("next_turn");
        await review.decide(decision);
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

  describe("applyPlanDecision() session status", () => {
    it("keeps the session running while an approved plan is implemented and idles when the turn finishes (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", async () => {
      const review = planReview("next_turn");
      expect(review.session.getStatus()).toBe("awaiting_permission");

      await review.decide("approve");
      await review.permission;
      expect(review.session.getStatus()).toBe("running");

      review.finishFirstTurn();
      await review.firstTurn;
      expect(review.session.getStatus()).toBe("idle");
    });
  });
});
