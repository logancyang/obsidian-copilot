import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
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

const AlignedWithResponseDemo: React.FC = () => {
  const app = useApp();
  return (
    <TooltipProvider>
      <div className="tw-group tw-flex tw-flex-col tw-gap-1">
        <AgentMarkdownText
          text="I excluded generated Copilot conversation logs and notes where AI was only mentioned incidentally."
          app={app}
        />
        <AgentMessageActions
          text="I excluded generated Copilot conversation logs and notes where AI was only mentioned incidentally."
          app={app}
          durationMs={24_000}
        />
      </div>
    </TooltipProvider>
  );
};

export const AlignedWithResponse: StoryObj<AgentTurnDurationIndicatorProps> = {
  render: AlignedWithResponseDemo,
};
