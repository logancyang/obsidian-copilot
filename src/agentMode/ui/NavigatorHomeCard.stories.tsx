import { NavigatorHomeCard, type NavigatorHomeCardProps } from "@/agentMode/ui/NavigatorHomeCard";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Navigator Home Card",
  component: NavigatorHomeCard,
  args: { showPlusMarker: false, onOpen: () => undefined, onDismiss: () => undefined },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<NavigatorHomeCardProps>;
export default meta;

export const PlusUser: StoryObj<NavigatorHomeCardProps> = {};

export const FreeUser: StoryObj<NavigatorHomeCardProps> = {
  args: { showPlusMarker: true },
};
