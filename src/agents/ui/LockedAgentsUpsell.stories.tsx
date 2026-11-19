import {
  LockedAgentsUpsellContent,
  type LockedAgentsUpsellContentProps,
} from "@/agents/ui/LockedAgentsUpsell";
import { COCO, LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Custom Agents/Locked Agents Upsell",
  component: LockedAgentsUpsellContent,
  args: { agents: [COCO, MAYA, LEO, NORA], onClose: () => undefined },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<LockedAgentsUpsellContentProps>;
export default meta;

export const ThisVaultHasCustomAgents: StoryObj<LockedAgentsUpsellContentProps> = {};

export const ThisVaultHasOneCustomAgent: StoryObj<LockedAgentsUpsellContentProps> = {
  args: { agents: [MAYA] },
};
