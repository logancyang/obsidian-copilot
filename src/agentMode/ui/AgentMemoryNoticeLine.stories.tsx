import { AgentMemoryNoticeLine } from "@/agentMode/ui/AgentMemoryNoticeLine";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentMemoryNoticeLineProps = React.ComponentProps<typeof AgentMemoryNoticeLine>;

const meta = {
  title: "Agent Mode/Memory Notice Line",
  component: AgentMemoryNoticeLine,
  args: { kind: "flush", agentName: "Jennifer", onOpen: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentMemoryNoticeLineProps>;
export default meta;

export const AfterAFlush: StoryObj<AgentMemoryNoticeLineProps> = {};

export const AfterAConsolidation: StoryObj<AgentMemoryNoticeLineProps> = {
  args: { kind: "consolidation" },
};

export const LongAgentName: StoryObj<AgentMemoryNoticeLineProps> = {
  args: { agentName: "The Long-Winded Developmental Editor Who Reads Every Draft Twice" },
};

export const BelowTheLastTurn: StoryObj<AgentMemoryNoticeLineProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <div className="tw-px-3 tw-text-ui-small tw-text-normal">
        Understood — the hydrogen section is out, and I will show edits as a diff from now on.
      </div>
      <AgentMemoryNoticeLine kind="flush" agentName="Jennifer" onOpen={() => {}} />
    </div>
  ),
};
