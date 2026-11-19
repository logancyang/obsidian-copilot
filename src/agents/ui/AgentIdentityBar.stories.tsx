import { AgentIdentityBar, type AgentIdentityBarProps } from "@/agents/ui/AgentIdentityBar";
import { COCO, LONG_NAMED_AGENT, MAYA } from "@/agents/ui/testing/rosterFixtures";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Copilot Teammates/Identity Bar",
  component: AgentIdentityBar,
  args: { agent: COCO },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<AgentIdentityBarProps>;
export default meta;

export const AgentChat: StoryObj<AgentIdentityBarProps> = {};

export const LongNameAndTitle: StoryObj<AgentIdentityBarProps> = {
  args: {
    agent: {
      ...LONG_NAMED_AGENT,
      name: "Nora · Family & School Logistics Coordinator for the Whole Household",
    },
  },
};

export const NoTitle: StoryObj<AgentIdentityBarProps> = {
  args: {
    agent: {
      ...MAYA,
      title: "",
      instruction:
        "Pressure-test product plans before they ship. Ask what would make the plan fail.",
    },
  },
};

export const OpensProfile: StoryObj<AgentIdentityBarProps> = {
  args: { onOpenProfile: () => {} },
};
