import {
  LockedAgentsUpsellContent,
  type LockedAgentsUpsellContentProps,
} from "@/agents/ui/LockedAgentsUpsell";
import { COCO, LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Custom Agents/Locked Agents Upsell",
  component: LockedAgentsUpsellContent,
  args: { agents: [COCO, MAYA, LEO, NORA], lapsed: true, onClose: () => undefined },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<LockedAgentsUpsellContentProps>;
export default meta;

export const YourAgentsAreStillHere: StoryObj<LockedAgentsUpsellContentProps> = {};

export const OneLapsedAgent: StoryObj<LockedAgentsUpsellContentProps> = {
  args: { agents: [MAYA] },
};

export const ThisVaultHasCustomAgents: StoryObj<LockedAgentsUpsellContentProps> = {
  args: { lapsed: false },
};
