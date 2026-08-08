import { AgentWelcomeCard } from "@/agentMode/ui/AgentWelcomeCard";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type AgentWelcomeCardProps = React.ComponentProps<typeof AgentWelcomeCard>;

const meta = {
  title: "Agent Mode/Agent Welcome Card",
  component: AgentWelcomeCard,
  args: {
    onCreate: () => undefined,
    onDismiss: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentWelcomeCardProps>;
export default meta;

export const Default: StoryObj<AgentWelcomeCardProps> = {};
