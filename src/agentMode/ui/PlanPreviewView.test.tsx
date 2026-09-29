import type { CurrentPlan, SessionId } from "@/agentMode/session/types";
import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { PlanPreviewRoot, PLAN_PREVIEW_VIEW_TYPE } from "@/agentMode/ui/PlanPreviewView";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn().mockResolvedValue(undefined),
}));

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

function makeApp(detach = jest.fn()) {
  const leaf = { detach, view: { getProposalId: () => "plan-1" } };
  const app = {
    workspace: {
      getActiveFile: () => null,
      getLeavesOfType: (type: string) => (type === PLAN_PREVIEW_VIEW_TYPE ? [leaf] : []),
    },
  } as unknown as App;
  return { app, detach };
}

function renderPreview(plan: CurrentPlan | null, detach?: jest.Mock) {
  const fixture = createFixtureClient({ sessionId: SESSION_ID, session: { plan } });
  const { app, detach: detachLeaf } = makeApp(detach);
  render(
    <PlanPreviewRoot
      app={app}
      state={{
        proposalId: "plan-1",
        planMarkdown: "- Goals",
        title: "Outline",
        client: fixture.client,
        sessionId: SESSION_ID,
      }}
    />
  );
  return { fixture, detach: detachLeaf };
}

describe("PlanPreviewView", () => {
  beforeAll(() => {
    // Obsidian adds `empty()` to every element; the preview clears its render target with it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/611
    (HTMLElement.prototype as unknown as { empty: () => void }).empty = function (
      this: HTMLElement
    ) {
      this.replaceChildren();
    };
  });

  describe("PlanPreviewRoot()", () => {
    it("shows the session's live plan title and offers a decision while the plan is pending", () => {
      renderPreview(PLAN);

      expect(screen.getByText("Outline the launch")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    });

    it("sends a resolvePlan approve command and closes the preview leaf when the user approves", async () => {
      const { fixture, detach } = renderPreview(PLAN);

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await act(async () => undefined);

      expect(fixture.commands).toMatchObject([
        { name: "resolvePlan", sessionId: SESSION_ID, proposalId: "plan-1", decision: "approve" },
      ]);
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it("sends a resolvePlan reject command and keeps the preview open when the user rejects", async () => {
      const { fixture, detach } = renderPreview(PLAN);

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      await act(async () => undefined);

      expect(fixture.commands).toMatchObject([{ name: "resolvePlan", decision: "reject" }]);
      expect(detach).not.toHaveBeenCalled();
    });

    it("says the plan is no longer pending once the session has no plan", () => {
      renderPreview(null);

      expect(screen.getByText(/Plan no longer pending/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    });

    it("withdraws the decision controls when the host records a decision", () => {
      const { fixture } = renderPreview(PLAN);

      act(() =>
        fixture.emitSession({ t: "slice", key: "plan", value: { ...PLAN, decision: "approved" } })
      );

      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    });
  });
});
