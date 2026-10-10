import { AgentDestinationLine } from "@/agentMode/ui/AgentDestinationLine";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type AgentDestinationLineProps = React.ComponentProps<typeof AgentDestinationLine>;

const meta = {
  title: "Agent Mode/Agent Destination Line",
  component: AgentDestinationLine,
  args: { destination: "Copilot Plus (Brevilabs, US)" },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentDestinationLineProps>;
export default meta;

export const CopilotPlus: StoryObj<AgentDestinationLineProps> = {};

export const LocalModel: StoryObj<AgentDestinationLineProps> = {
  args: { destination: "this computer" },
};

export const CustomServer: StoryObj<AgentDestinationLineProps> = {
  args: { destination: "the server set in your Claude Code settings" },
};
