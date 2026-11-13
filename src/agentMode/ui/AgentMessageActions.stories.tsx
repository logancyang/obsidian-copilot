import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentMessageActionsProps = React.ComponentProps<typeof AgentMessageActions>;

const REPLY =
  "The trip note lists three hotels. The one near the station has the lowest price and free cancellation.";

const meta = {
  title: "Agent Mode/Agent Message Actions",
  component: AgentMessageActions,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentMessageActionsProps>;
export default meta;

const ReplyDemo: React.FC<{ canContinue: boolean }> = ({ canContinue }) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <div className="tw-group tw-flex tw-flex-col tw-gap-1">
        <AgentMarkdownText text={REPLY} app={app} />
        <AgentMessageActions
          text={REPLY}
          app={app}
          durationMs={12_000}
          timestamp="2026/11/11 10:02:11"
          onContinue={canContinue ? () => {} : undefined}
        />
      </div>
    </TooltipProvider>
  );
};

export const IdleChat: StoryObj<AgentMessageActionsProps> = {
  render: () => <ReplyDemo canContinue />,
};

export const ChatGenerating: StoryObj<AgentMessageActionsProps> = {
  render: () => <ReplyDemo canContinue={false} />,
};
