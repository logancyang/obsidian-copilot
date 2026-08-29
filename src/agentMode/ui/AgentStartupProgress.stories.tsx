import {
  AgentStartupProgress,
  type AgentStartupProgressProps,
} from "@/agentMode/ui/AgentStartupProgress";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Agent Startup Progress",
  component: AgentStartupProgress,
  parameters: { gallery: { host: "leaf", layout: "centered" } },
} satisfies Meta<AgentStartupProgressProps>;
export default meta;

export const LoadingCopilotPlusModels: StoryObj<AgentStartupProgressProps> = {
  args: { stage: "plus-catalog", agentName: "opencode" },
};

export const StartingOpenCode: StoryObj<AgentStartupProgressProps> = {
  args: { stage: "backend", agentName: "opencode" },
};

export const ContinuingOffline: StoryObj<AgentStartupProgressProps> = {
  args: { stage: "backend-without-plus", agentName: "opencode" },
};
