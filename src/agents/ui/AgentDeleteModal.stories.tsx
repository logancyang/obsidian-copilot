import { AgentDeleteForm, type AgentDeleteFormProps } from "@/agents/ui/AgentDeleteModal";
import { COCO, KAI } from "@/agents/ui/testing/rosterFixtures";
import type { Meta, StoryObj } from "@/lib/story";

function files(slug: string) {
  return {
    instructionsPath: `copilot/teammates/${slug}/instructions.md`,
    memoryPath: `copilot/teammates/${slug}/MEMORY.md`,
  };
}

const meta = {
  title: "Copilot Teammates/Delete Agent Dialog",
  component: AgentDeleteForm,
  args: {
    agent: { ...COCO, ...files("coco") },
    memoryRules: 9,
    chatCount: 23,
    onDelete: () => {},
    onCancel: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<AgentDeleteFormProps>;
export default meta;

export const AgentWithMemoryAndChats: StoryObj<AgentDeleteFormProps> = {};

export const WorkingInAnotherChat: StoryObj<AgentDeleteFormProps> = {
  args: { workingIn: "Maya" },
};

export const NewAgentWithNoMemory: StoryObj<AgentDeleteFormProps> = {
  args: {
    agent: { ...KAI, ...files("kai") },
    memoryRules: null,
    chatCount: 0,
  },
};

export const LongAgentName: StoryObj<AgentDeleteFormProps> = {
  args: {
    agent: {
      ...COCO,
      ...files("nora"),
      name: "Nora · Family & School Logistics Coordinator for the Whole Household",
    },
    chatCount: 4,
  },
};
