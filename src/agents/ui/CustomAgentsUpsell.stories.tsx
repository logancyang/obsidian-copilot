import {
  CustomAgentsUpsellContent,
  type CustomAgentsUpsellContentProps,
} from "@/agents/ui/CustomAgentsUpsell";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Copilot Teammates/Copilot Teammates Upsell",
  component: CustomAgentsUpsellContent,
  args: { medium: "custom_agent_dialog", onClose: () => undefined },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CustomAgentsUpsellContentProps>;
export default meta;

export const WithVideo: StoryObj<CustomAgentsUpsellContentProps> = {};

export const WithoutVideo: StoryObj<CustomAgentsUpsellContentProps> = {
  args: { video: null },
};
