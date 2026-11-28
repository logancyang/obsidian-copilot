import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { UsageMeter } from "@/agentMode/ui/AgentContextMeter";
import { RunningTasksIndicator } from "@/agentMode/ui/RunningTasksIndicator";
import { makeTask } from "@/agentMode/ui/testing/taskFixtures";
import type { AgentMention } from "@/agents/agentMentions";
import { runningAgentsSlot, type RunningAgent } from "@/agents/agentMode/ui/RunningAgents";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { KAI, LEO, LONG_NAMED_AGENT, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

interface LineProps {
  runs: readonly RunningAgent[];
  taskCount: number;
  defaultOpen?: boolean;
}

const STARTED = Date.now() - 3 * 60_000 - 12_000;

const ASKED: Record<string, string> = {
  leo: "Reconcile last month's books against the Mercury export. Flag anything that doesn't match.",
  maya: "Review the launch video plan. Be blunt.",
  nora: "Check whether the school pickup schedule clashes with the offsite.",
  kai: "Draft the launch post from the release notes.",
  [LONG_NAMED_AGENT.slug]: "Check whether the school pickup schedule clashes with the offsite.",
};

function asked(
  agent: CustomAgent,
  status: AgentMention["status"] = "working",
  startedAt = STARTED
): RunningAgent {
  return {
    mention: { id: agent.slug, agent: agent.slug, name: agent.name, status, startedAt },
    message: ASKED[agent.slug],
    faceSrc: agent.faceSrc,
  };
}

const RunningLine: React.FC<LineProps> = ({ runs, taskCount, defaultOpen }) => (
  <TooltipProvider>
    <div className="tw-flex tw-h-72 tw-items-end">
      <RunningTasksIndicator
        tasks={Array.from({ length: taskCount }, (_, i) =>
          makeTask({ taskId: `task-${i}`, toolCallId: `call-${i}` })
        )}
        permissions={[]}
        onOpenTask={() => {}}
        defaultOpen={defaultOpen}
        runs={runningAgentsSlot({ runs, taskCount, onOpen: () => {}, onStop: () => {} })}
      />
    </div>
  </TooltipProvider>
);

const meta = {
  title: "Copilot Teammates/Running Agents",
  component: RunningLine,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { runs: [asked(MAYA)], taskCount: 0 },
} satisfies Meta<LineProps>;
export default meta;

export const OneAgentWorking: StoryObj<LineProps> = {};

export const TwoAgentsWorking: StoryObj<LineProps> = {
  args: { runs: [asked(MAYA), asked(LEO)] },
};

export const ThreeAgentsWorking: StoryObj<LineProps> = {
  args: { runs: [asked(MAYA), asked(LEO), asked(NORA)] },
};

export const FourOrMoreAgentsWorking: StoryObj<LineProps> = {
  args: { runs: [asked(MAYA), asked(LEO), asked(NORA), asked(KAI)] },
};

export const WaitingOnAQuestion: StoryObj<LineProps> = {
  args: { runs: [asked(LEO, "question")] },
};

export const NeedsYourOk: StoryObj<LineProps> = {
  args: { runs: [asked(LEO, "permission")] },
};

export const WaitingFirstWhileAnotherWorks: StoryObj<LineProps> = {
  args: { runs: [asked(MAYA), asked(LEO, "question")] },
};

export const AgentAndTask: StoryObj<LineProps> = {
  args: { runs: [asked(LEO)], taskCount: 1 },
};

export const PopoverRows: StoryObj<LineProps> = {
  args: {
    runs: [asked(LEO), asked(MAYA, "working", Date.now() - 40_000)],
    taskCount: 1,
    defaultOpen: true,
  },
};

export const PopoverWaitingRow: StoryObj<LineProps> = {
  args: {
    runs: [asked(MAYA, "working", Date.now() - 40_000), asked(LEO, "question")],
    defaultOpen: true,
  },
};

export const InTheChatControls: StoryObj<LineProps> = {
  args: { runs: [asked(MAYA), asked(LONG_NAMED_AGENT, "question")] },
  render: ({ runs = [], taskCount = 0 }) => (
    <TooltipProvider>
      <AgentChatControls
        onNewChat={() => {}}
        onSaveAsNote={() => {}}
        usageMeter={
          <UsageMeter
            usage={{ usedTokens: 48_000, contextWindow: 200_000, updatedAt: STARTED }}
            contextWindow={200_000}
            planUsage={null}
          />
        }
        tasksIndicator={
          <RunningTasksIndicator
            tasks={[]}
            permissions={[]}
            onOpenTask={() => {}}
            runs={runningAgentsSlot({ runs, taskCount, onOpen: () => {}, onStop: () => {} })}
          />
        }
      />
    </TooltipProvider>
  ),
};
