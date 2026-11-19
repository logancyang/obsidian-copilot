import { FirstAgentBanner, type FirstAgentBannerProps } from "@/agents/ui/FirstAgentBanner";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Custom Agents/First Agent Banner",
  component: FirstAgentBanner,
  args: { onCreate: () => {}, onDismiss: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<FirstAgentBannerProps>;
export default meta;

export const Default: StoryObj<FirstAgentBannerProps> = {};
