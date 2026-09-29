import { UsageMeter, type UsageMeterProps } from "@/agentMode/ui/AgentContextMeter";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

function UsageMeterStory(props: UsageMeterProps) {
  return (
    <TooltipProvider>
      <UsageMeter {...props} />
    </TooltipProvider>
  );
}

const meta = {
  title: "Agent Mode/UsageMeter",
  component: UsageMeterStory,
} satisfies Meta<UsageMeterProps>;
export default meta;

const HOUR = 60 * 60 * 1000;

const NOW = Date.now();

const CONTEXT: UsageMeterProps["usage"] = {
  usedTokens: 48_000,
  contextWindow: 200_000,
  updatedAt: NOW,
};

export const AwaitingSessionUsage: StoryObj<UsageMeterProps> = {
  args: {
    usage: null,
    contextWindow: null,
    planUsage: {
      windows: [{ id: "weekly", label: "Weekly", percent: 15, resetsAt: NOW + 80 * HOUR }],
      updatedAt: NOW,
    },
  },
};

export const ContextAndCaps: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [
        { id: "five_hour", label: "5h", percent: 12, resetsAt: NOW + 3 * HOUR },
        { id: "seven_day", label: "Weekly", percent: 21, resetsAt: NOW + 52 * HOUR },
      ],
      updatedAt: NOW,
    },
  },
};

export const ContextOnly: StoryObj<UsageMeterProps> = {
  args: { usage: CONTEXT, contextWindow: 200_000, planUsage: null },
};

export const CapsWithoutContextWindow: StoryObj<UsageMeterProps> = {
  args: {
    usage: { usedTokens: 12_400, updatedAt: NOW },
    contextWindow: null,
    planUsage: {
      windows: [{ id: "primary", label: "Weekly", percent: 15, resetsAt: NOW + 80 * HOUR }],
      updatedAt: NOW,
    },
  },
};

export const ContextNearlyFull: StoryObj<UsageMeterProps> = {
  args: {
    usage: { usedTokens: 186_000, contextWindow: 200_000, updatedAt: NOW },
    contextWindow: 200_000,
    planUsage: {
      windows: [{ id: "seven_day", label: "Weekly", percent: 91, resetsAt: NOW + 4 * HOUR }],
      updatedAt: NOW,
    },
  },
};

export const OverCap: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [{ id: "seven_day", label: "Weekly", percent: 143, resetsAt: NOW + 9 * HOUR }],
      updatedAt: NOW,
    },
  },
};

export const CapWithoutReset: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [{ id: "seven_day", label: "Weekly", percent: 21 }],
      updatedAt: NOW,
    },
  },
};

export const ModelScopedCaps: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [
        { id: "seven_day", label: "Weekly", percent: 21, resetsAt: NOW + 52 * HOUR },
        {
          id: "model_scoped:Fable",
          label: "Weekly (Fable)",
          percent: 64,
          resetsAt: NOW + 52 * HOUR,
        },
      ],
      updatedAt: NOW,
    },
  },
};
