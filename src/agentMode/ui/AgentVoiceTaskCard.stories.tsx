import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AgentVoiceTaskCard,
  type AgentVoiceTaskCardProps,
} from "@/agentMode/ui/AgentVoiceTaskCard";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
const task: AgentVoiceTaskCardProps["task"] = {
  taskId: "launch-notes",
  sourceMessageIds: ["request"],
  delegationIds: [],
  state: "running",
  presentation: "voice-card",
  assistantMessageId: "answer",
};
function TaskCardDemo(args: AgentVoiceTaskCardProps) {
  return (
    <TooltipProvider>
      <AgentVoiceTaskCard {...args} app={useApp()} />
    </TooltipProvider>
  );
}
const meta = {
  title: "Agent/Voice task",
  component: TaskCardDemo,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { task, backendDisplayName: "Codex" },
} satisfies Meta<AgentVoiceTaskCardProps>;
export default meta;
export const Working: StoryObj<AgentVoiceTaskCardProps> = {};
export const Queued: StoryObj<AgentVoiceTaskCardProps> = {
  args: { task: { ...task, state: "queued" } },
};
export const NeedsInput: StoryObj<AgentVoiceTaskCardProps> = {
  args: { task: { ...task, state: "awaiting-user" } },
};
export const RestoredAnswer: StoryObj<AgentVoiceTaskCardProps> = {
  args: {
    task: { ...task, state: "completed" },
    details: {
      task: { ...task, state: "completed" },
      activityAvailable: false,
      messages: [
        {
          id: "answer",
          sender: "ai",
          message:
            "The launch review identifies onboarding as the main risk. See [[Launch review]] for the complete feedback.",
          isVisible: true,
          timestamp: null,
        },
      ],
    },
  },
};
export const Failed: StoryObj<AgentVoiceTaskCardProps> = {
  args: { task: { ...task, state: "failed" } },
};
