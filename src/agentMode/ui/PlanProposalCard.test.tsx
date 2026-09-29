import type { CommandResult } from "@/agentMode/protocol/commands";
import type { CurrentPlan, SessionId } from "@/agentMode/session/types";
import {
  AgentPaneCapabilitiesProvider,
  NO_PANE_CAPABILITIES,
  type AgentPaneCapabilities,
} from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const SESSION_ID = "s1" as SessionId;

const PLAN: CurrentPlan = {
  id: "plan-1",
  revision: 1,
  title: "Outline the launch",
  body: "- Goals\n- Risks",
  permissionGated: true,
  pendingToolCallId: "plan-review",
  decision: "pending",
};

const REJECTED: CommandResult = { ok: false, code: "failed", message: "disconnected" };

function renderCard(
  capabilities: AgentPaneCapabilities = NO_PANE_CAPABILITIES,
  plan: CurrentPlan = PLAN,
  onCommand?: () => CommandResult
) {
  const fixture = createFixtureClient({ sessionId: SESSION_ID, session: { plan }, onCommand });
  render(
    <AgentPaneCapabilitiesProvider value={capabilities}>
      <PlanProposalCard plan={plan} client={fixture.client} sessionId={SESSION_ID} />
    </AgentPaneCapabilitiesProvider>
  );
  return fixture;
}

describe("PlanProposalCard", () => {
  describe("PlanProposalCard()", () => {
    it("sends a resolvePlan approve command and closes the plan preview when the user approves", async () => {
      const closePlanPreview = jest.fn();
      const fixture = renderCard({ ...NO_PANE_CAPABILITIES, closePlanPreview });

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await act(async () => undefined);

      expect(fixture.commands).toEqual([
        {
          name: "resolvePlan",
          sessionId: SESSION_ID,
          proposalId: "plan-1",
          decision: "approve",
          feedbackText: undefined,
        },
      ]);
      expect(closePlanPreview).toHaveBeenCalledWith("plan-1");
    });

    it("sends a resolvePlan reject command without closing the plan preview when the user rejects", async () => {
      const closePlanPreview = jest.fn();
      const fixture = renderCard({ ...NO_PANE_CAPABILITIES, closePlanPreview });

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      await act(async () => undefined);

      expect(fixture.commands).toMatchObject([{ name: "resolvePlan", decision: "reject" }]);
      expect(closePlanPreview).not.toHaveBeenCalled();
    });

    it("sends the trimmed feedback with a feedback decision and clears the field", async () => {
      const fixture = renderCard();
      const field = screen.getByPlaceholderText("Give feedback to redirect the plan…");

      fireEvent.change(field, { target: { value: "  Cover the risks first  " } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await act(async () => undefined);

      expect(fixture.commands).toMatchObject([
        { name: "resolvePlan", decision: "feedback", feedbackText: "Cover the risks first" },
      ]);
      expect((field as HTMLTextAreaElement).value).toBe("");
    });

    it("opens the plan preview with the proposal and its session when the environment can host one", async () => {
      const openPlanPreview = jest.fn().mockResolvedValue(undefined);
      renderCard({ ...NO_PANE_CAPABILITIES, openPlanPreview });

      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      await act(async () => undefined);

      expect(openPlanPreview).toHaveBeenCalledWith({
        proposalId: "plan-1",
        sessionId: SESSION_ID,
        planMarkdown: "- Goals\n- Risks",
        title: "Outline the launch",
      });
    });

    it("hides the Open control when the environment cannot host a plan preview", () => {
      renderCard();
      expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    });

    it("offers no decision controls once the plan is decided", () => {
      renderCard(NO_PANE_CAPABILITIES, { ...PLAN, decision: "approved" });

      expect(screen.getByText("Approved")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    });

    it("keeps the plan preview open and the controls usable when an approval is rejected", async () => {
      const closePlanPreview = jest.fn();
      renderCard({ ...NO_PANE_CAPABILITIES, closePlanPreview }, PLAN, () => REJECTED);

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await act(async () => undefined);

      expect(closePlanPreview).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", false);
    });

    it("keeps the typed feedback when the feedback decision is rejected", async () => {
      renderCard(NO_PANE_CAPABILITIES, PLAN, () => REJECTED);
      const field = screen.getByPlaceholderText("Give feedback to redirect the plan…");

      fireEvent.change(field, { target: { value: "Cover the risks first" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await act(async () => undefined);

      expect((field as HTMLTextAreaElement).value).toBe("Cover the risks first");
    });
  });
});
