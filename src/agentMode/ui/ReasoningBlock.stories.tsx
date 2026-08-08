import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type ReasoningBlockProps = React.ComponentProps<typeof ReasoningBlock>;

const REASONING = {
  kind: "thought" as const,
  text: "Comparing the implementation with the current interface before making the change.",
};

const meta = {
  title: "Agent Mode/Reasoning Block",
  component: ReasoningBlock,
  args: { part: REASONING, isStreaming: false },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ReasoningBlockProps>;
export default meta;

export const Complete: StoryObj<ReasoningBlockProps> = {};

export const Active: StoryObj<ReasoningBlockProps> = {
  args: { isStreaming: true },
};

/** Matches the completed trail order so the response footer can be inspected as one row. */
const ReasoningResponseDurationDemo: React.FC = () => {
  const app = useApp();
  return (
    <TooltipProvider>
      <div className="tw-group tw-flex tw-flex-col tw-gap-1">
        <ReasoningBlock part={REASONING} isStreaming={false} />
        <AgentMarkdownText
          text="The completed duration now shares a centered footer with the response controls."
          app={app}
        />
        <AgentMessageActions
          text="The completed duration now shares a centered footer with the response controls."
          app={app}
          durationMs={138_000}
        />
      </div>
    </TooltipProvider>
  );
};

export const WithResponseAndWorkedFor: StoryObj<ReasoningBlockProps> = {
  render: ReasoningResponseDurationDemo,
};
