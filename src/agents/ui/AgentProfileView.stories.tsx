import {
  AgentProfileView,
  type AgentProfileFacts,
  type AgentProfileViewProps,
} from "@/agents/ui/AgentProfileView";
import { COCO, KAI, LONG_NAMED_AGENT } from "@/agents/ui/testing/rosterFixtures";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const NOW = new Date(2026, 10, 16, 15, 20).getTime();

const COCO_INSTRUCTION =
  "You keep the whole vault in view. Launch plans live in Launch/, release notes in copilot/releases/. Answer briefly and link the notes you used.";

const COCO_FACTS: AgentProfileFacts = {
  chatCount: 23,
  createdAt: new Date(2026, 9, 3, 9, 0).getTime(),
  editedAt: new Date(2026, 10, 2, 17, 45).getTime(),
  memory: { rules: 9, changedAt: new Date(2026, 10, 16, 14, 31).getTime() },
};

function paths(slug: string) {
  return {
    instructionsPath: `copilot/agents/${slug}/instructions.md`,
    memoryPath: `copilot/agents/${slug}/MEMORY.md`,
  };
}

function SidebarPage(props: AgentProfileViewProps) {
  return (
    <div className="tw-h-[640px]">
      <AgentProfileView {...props} />
    </div>
  );
}

const meta = {
  title: "Custom Agents/Agent Profile",
  component: SidebarPage,
  args: {
    agent: { ...COCO, instruction: COCO_INSTRUCTION, ...paths("coco") },
    facts: COCO_FACTS,
    now: NOW,
    onBack: () => {},
    onNewChat: () => {},
    onOpenFile: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<AgentProfileViewProps>;
export default meta;

export const FullProfile: StoryObj<AgentProfileViewProps> = {};

export const NewAgentWithNoMemory: StoryObj<AgentProfileViewProps> = {
  args: {
    agent: {
      ...KAI,
      instruction:
        "You write launch posts and the newsletter. Lead with what the user can now do. Plain words, short sentences.",
      ...paths("kai"),
    },
    facts: { chatCount: 1, createdAt: NOW - 3_600_000, editedAt: NOW - 3_600_000, memory: null },
  },
};

export const LongNameAndTitle: StoryObj<AgentProfileViewProps> = {
  args: {
    agent: {
      ...LONG_NAMED_AGENT,
      name: "Nora · Family & School Logistics Coordinator for the Whole Household",
      instruction: "You run the family calendar.",
      ...paths("nora-family-school"),
    },
    facts: {
      chatCount: 4,
      createdAt: new Date(2026, 8, 21).getTime(),
      editedAt: new Date(2026, 8, 21).getTime(),
      memory: null,
    },
  },
};

export const InstructionPastFourThousand: StoryObj<AgentProfileViewProps> = {
  args: {
    agent: {
      ...COCO,
      instruction: `${COCO_INSTRUCTION} `.repeat(32).slice(0, 4620),
      ...paths("coco"),
    },
    facts: {
      ...COCO_FACTS,
      memory: { rules: 31, changedAt: new Date(2026, 10, 12, 9, 0).getTime() },
    },
  },
};
