import { InterruptedTurnCard } from "@/agentMode/ui/InterruptedTurnCard";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type InterruptedTurnCardProps = React.ComponentProps<typeof InterruptedTurnCard>;

const meta = {
  title: "Agent Mode/Interrupted Turn Card",
  component: InterruptedTurnCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<InterruptedTurnCardProps>;
export default meta;

export const Default: StoryObj<InterruptedTurnCardProps> = {
  args: { onResume: () => undefined, onRetry: () => undefined },
};

export const RetryOnly: StoryObj<InterruptedTurnCardProps> = {
  args: { onRetry: () => undefined },
};
