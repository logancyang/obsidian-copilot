import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendDescriptor } from "@/agentMode/session/descriptor";
import type { BackendProcess, PermissionPrompt } from "@/agentMode/session/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));

describe("AgentChatUIState", () => {
  describe("resolvePlanProposal()", () => {
    function planReview(feedbackDelivery?: "permission" | "next_turn") {
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
        registerSessionHandler: () => () => undefined,
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
      const permission = session.handlePlanProposalPermission(request);
      const plan = chat.getCurrentPlan();
      if (!plan) throw new Error("Expected a pending plan");
      return {
        chat,
        plan,
        permission,
        prompt,
        firstTurn,
        finishFirstTurn: () => finishFirstTurn!({ stopReason: "end_turn" }),
        failFirstTurn: () => failFirstTurn!(new Error("ACP transport closed")),
      };
    }

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
});
