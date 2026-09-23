import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { CurrentPlan } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";
import type { App } from "obsidian";
import type * as React from "react";

type PlanProposalCardProps = React.ComponentProps<typeof PlanProposalCard>;

const plan = {
  id: "gallery-plan",
  revision: 1,
  title: "Create the project outline after approval",
  body: "Create `project-outline.md` with three sections:\n\n- Goals\n- Milestones\n- Risks",
  permissionGated: true,
  pendingToolCallId: "gallery-plan-review",
  decision: "pending",
} satisfies CurrentPlan;

const app = {
  workspace: {
    getLeavesOfType: () => [],
    getLeaf: () => ({ setViewState: async () => undefined }),
    revealLeaf: () => undefined,
  },
} as unknown as App;

const meta = {
  title: "Agent Mode/Plan Proposal Card",
  component: PlanProposalCard,
  args: {
    plan,
    app,
    chatBackend: { resolvePlanProposal: async () => undefined } as unknown as AgentChatBackend,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<PlanProposalCardProps>;
export default meta;

export const Pending: StoryObj<PlanProposalCardProps> = {};
