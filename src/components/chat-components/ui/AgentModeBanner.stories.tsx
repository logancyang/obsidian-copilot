import {
  AgentModeBanner,
  type AgentModeBannerProps,
} from "@/components/chat-components/ui/AgentModeBanner";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Chat/Agent Mode Banner",
  component: AgentModeBanner,
  args: { onOpenAgent: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentModeBannerProps>;
export default meta;

/** The empty Quick Chat invitation: one action heading with quieter supporting copy. */
export const Default: StoryObj<AgentModeBannerProps> = {};
