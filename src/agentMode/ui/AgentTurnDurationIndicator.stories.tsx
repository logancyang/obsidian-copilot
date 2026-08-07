import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTurnDurationIndicatorProps = React.ComponentProps<typeof AgentTurnDurationIndicator>;

const meta = {
  title: "Agent Mode/Agent Turn Duration Indicator",
  component: AgentTurnDurationIndicator,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTurnDurationIndicatorProps>;
export default meta;

const RunningDemo: React.FC = () => (
  <AgentTurnDurationIndicator status="running" startedAtMs={Date.now() - 138_000} />
);

export const Running: StoryObj<AgentTurnDurationIndicatorProps> = {
  render: RunningDemo,
};

export const Complete: StoryObj<AgentTurnDurationIndicatorProps> = {
  args: { status: "complete", durationMs: 138_000 },
};

export const AlignedWithResponse: StoryObj<AgentTurnDurationIndicatorProps> = {
  render: () => (
    <div>
      <div className="tw-p-1 tw-text-sm">
        I excluded generated Copilot conversation logs and notes where AI was only mentioned
        incidentally.
      </div>
      <AgentTurnDurationIndicator status="complete" durationMs={24_000} />
    </div>
  ),
};
