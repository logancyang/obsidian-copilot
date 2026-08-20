import {
  AgentModePromoRow,
  type AgentModePromoRowProps,
} from "@/components/chat-components/ui/AgentModePromoRow";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Chat/Agent Mode Promo Row",
  component: AgentModePromoRow,
  args: { dismissed: false, onOpenAgent: () => {}, onDismiss: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentModePromoRowProps>;
export default meta;

export const Default: StoryObj<AgentModePromoRowProps> = {};

/** Dismissed for good: the composer footer collapses to nothing. */
export const Dismissed: StoryObj<AgentModePromoRowProps> = { args: { dismissed: true } };
