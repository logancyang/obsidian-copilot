import type { AgentMessagePart } from "@/agentMode/session/types";
import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { TaskCard, type TaskCardProps } from "@/agentMode/ui/TaskCard";
import { makeCommandTask, makeTask } from "@/agentMode/ui/testing/taskFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const meta = {
  title: "Agent Mode/Task Card",
  component: TaskCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { task: makeTask(), onOpen: () => {} },
} satisfies Meta<TaskCardProps>;
export default meta;

export const Running: StoryObj<TaskCardProps> = {};

export const Starting: StoryObj<TaskCardProps> = {
  args: { task: makeTask({ taskId: undefined, description: "", subagentType: undefined }) },
};

export const Completed: StoryObj<TaskCardProps> = {
  args: { task: makeTask({ status: "completed" }) },
};

export const Failed: StoryObj<TaskCardProps> = {
  args: { task: makeCommandTask({ status: "failed" }) },
};

export const Stopped: StoryObj<TaskCardProps> = {
  args: { task: makeCommandTask({ status: "stopped" }) },
};

export const LongTitle: StoryObj<TaskCardProps> = {
  args: {
    task: makeTask({
      description:
        "Read every meeting note from the last quarter and collect the open action items by owner",
    }),
  },
};

const LAUNCH_REPLY: AgentMessagePart[] = [
  { kind: "text", text: "I'll count the words and print progress in the background." },
  {
    kind: "tool_call",
    id: "call-1",
    title: "Agent",
    status: "in_progress",
    vendorToolName: "Agent",
    input: { description: "Count words in Welcome", subagent_type: "general-purpose" },
  },
  {
    kind: "tool_call",
    id: "call-2",
    title: "Bash",
    status: "in_progress",
    vendorToolName: "Bash",
    toolKind: "execute",
    input: { command: "for i in $(seq 1 30); do echo line $i; sleep 1; done" },
  },
  { kind: "text", text: "Both are running. I'll report when they finish." },
];

const InReplyDemo: React.FC = () => {
  const app = useApp();
  return (
    <TooltipProvider>
      <AgentTasksProvider
        tasks={[makeTask(), makeCommandTask({ status: "completed" })]}
        openTask={() => {}}
      >
        <AgentTrail parts={LAUNCH_REPLY} isStreaming={false} turnStopReason="end_turn" app={app} />
      </AgentTasksProvider>
    </TooltipProvider>
  );
};

export const InLaunchingReply: StoryObj<TaskCardProps> = {
  render: () => <InReplyDemo />,
};
