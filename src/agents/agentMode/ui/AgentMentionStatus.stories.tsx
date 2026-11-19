import type { AgentMention } from "@/agents/agentMentions";
import { AgentMentionStatus } from "@/agents/agentMode/ui/AgentMentionStatus";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

interface StatusProps {
  mention: AgentMention;
}

const STARTED = Date.now() - 3 * 60_000 - 12_000;

function run(change: Partial<AgentMention>): AgentMention {
  return { id: "m1", agent: "leo", name: "Leo", status: "working", startedAt: STARTED, ...change };
}

const meta = {
  title: "Custom Agents/Mention Status",
  component: AgentMentionStatus,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<StatusProps>;
export default meta;

export const Working: StoryObj<StatusProps> = { args: { mention: run({}) } };

export const HasAQuestion: StoryObj<StatusProps> = {
  args: { mention: run({ status: "question", endedAt: STARTED + 4 * 60_000 + 30_000 }) },
};

export const NeedsYourOk: StoryObj<StatusProps> = {
  args: { mention: run({ status: "permission", endedAt: STARTED + 9 * 60_000 + 48_000 }) },
};

export const Finished: StoryObj<StatusProps> = {
  args: { mention: run({ status: "finished", endedAt: STARTED + 12 * 60_000 + 4_000 }) },
};

export const Stopped: StoryObj<StatusProps> = {
  args: {
    mention: run({
      status: "stopped",
      endedAt: STARTED + 6 * 60_000 + 40_000,
      end: { kind: "stopped_by_user" },
    }),
  },
};

export const StoppedBecauseDeleted: StoryObj<StatusProps> = {
  args: {
    mention: run({
      status: "stopped",
      endedAt: STARTED + 2 * 60_000,
      end: { kind: "agent_deleted" },
    }),
  },
};

export const DidntFinishObsidianClosed: StoryObj<StatusProps> = {
  args: { mention: run({ status: "didnt_finish", end: { kind: "obsidian_closed" } }) },
};

export const DidntFinishWithAnError: StoryObj<StatusProps> = {
  args: {
    mention: run({
      status: "didnt_finish",
      endedAt: STARTED + 7 * 60_000 + 15_000,
      end: {
        kind: "error",
        message:
          "Leo's chat stopped before it finished. The agent process exited with code 1 after the model returned an overloaded error.",
      },
    }),
  },
};

export const DidntFinishTurnedDown: StoryObj<StatusProps> = {
  args: {
    mention: run({
      status: "didnt_finish",
      endedAt: STARTED + 60_000,
      end: { kind: "permission_denied", requests: ["Edit Finance/Books/October books.md"] },
    }),
  },
};

export const LongName: StoryObj<StatusProps> = {
  args: {
    mention: run({
      name: "Nora · Family & School",
      status: "didnt_finish",
      end: { kind: "permission_denied", requests: ["Edit a.md", "Edit b.md"] },
    }),
  },
};

export const SeveralAgents: StoryObj<StatusProps> = {
  args: { mention: run({}) },
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-0.5">
      <AgentMentionStatus
        mention={run({ id: "m1", name: "Maya", status: "finished", endedAt: STARTED + 70_000 })}
      />
      <AgentMentionStatus mention={run({ id: "m2" })} />
    </div>
  ),
};
