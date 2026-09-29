import type { CurrentPlan, SessionId } from "@/agentMode/session/types";
import { AgentPaneCapabilitiesProvider } from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient, inertPaneCapabilities } from "@/agentMode/ui/agentPane.fixtures";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type PlanProposalCardProps = React.ComponentProps<typeof PlanProposalCard>;

const SESSION_ID = "gallery-session" as SessionId;

const plan = {
  id: "gallery-plan",
  revision: 1,
  title: "Create the project outline after approval",
  body: "Create `project-outline.md` with three sections:\n\n- Goals\n- Milestones\n- Risks",
  permissionGated: true,
  pendingToolCallId: "gallery-plan-review",
  decision: "pending",
} satisfies CurrentPlan;

const PendingDemo: React.FC = () => {
  const fixture = React.useMemo(
    () =>
      createFixtureClient({
        sessionId: SESSION_ID,
        session: { plan, pending: { permissions: [], questions: [], planPermission: true } },
      }),
    []
  );
  return (
    <AgentPaneCapabilitiesProvider value={inertPaneCapabilities}>
      <PlanProposalCard plan={plan} client={fixture.client} sessionId={SESSION_ID} />
    </AgentPaneCapabilitiesProvider>
  );
};

const meta = {
  title: "Agent Mode/Plan Proposal Card",
  component: PlanProposalCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<PlanProposalCardProps>;
export default meta;

export const Pending: StoryObj<PlanProposalCardProps> = { render: PendingDemo };
