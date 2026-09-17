import { AgentMemoryNoticeLine } from "@/agentMode/ui/AgentMemoryNoticeLine";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentMemoryNoticeLineProps = React.ComponentProps<typeof AgentMemoryNoticeLine>;

const meta = {
  title: "Agent Mode/Memory Notice Line",
  component: AgentMemoryNoticeLine,
  args: { agentName: "Jennifer", onOpen: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentMemoryNoticeLineProps>;
export default meta;

/** What the chat shows once the agent has rewritten its file: one line, no modal. */
export const AfterAnUpdate: StoryObj<AgentMemoryNoticeLineProps> = {};

/** A long agent name truncates rather than pushing the open link out of reach. */
export const LongAgentName: StoryObj<AgentMemoryNoticeLineProps> = {
  args: { agentName: "The Long-Winded Developmental Editor Who Reads Every Draft Twice" },
};

/** In place under the last turn, where the conversation ended. */
export const BelowTheLastTurn: StoryObj<AgentMemoryNoticeLineProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <div className="tw-px-3 tw-text-ui-small tw-text-normal">
        Understood — the hydrogen section is out, and I will show edits as a diff from now on.
      </div>
      <AgentMemoryNoticeLine agentName="Jennifer" onOpen={() => {}} />
    </div>
  ),
};
