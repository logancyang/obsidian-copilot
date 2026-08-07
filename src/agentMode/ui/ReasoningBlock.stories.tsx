import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
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

/** Matches the real trail order so all three content edges can be inspected together. */
const ReasoningResponseDurationDemo: React.FC = () => {
  const app = useApp();
  return (
    <div>
      <ReasoningBlock part={REASONING} isStreaming />
      <AgentMarkdownText
        text="The reasoning and duration indicators now share the response's left edge."
        app={app}
      />
      <AgentTurnDurationIndicator status="running" startedAtMs={Date.now() - 138_000} />
    </div>
  );
};

export const WithResponseAndWorkedFor: StoryObj<ReasoningBlockProps> = {
  render: ReasoningResponseDurationDemo,
};
