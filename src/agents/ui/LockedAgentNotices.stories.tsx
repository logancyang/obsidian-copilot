import { LockedAgentChat, type LockedAgentChatProps } from "@/agents/ui/LockedAgentNotices";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Copilot Teammates/Locked Agent Chat",
  component: LockedAgentChat,
  args: { name: "Coco", onNewChat: () => {}, onUnlock: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<LockedAgentChatProps>;
export default meta;

export const ReadOnlyWithoutValidLicense: StoryObj<LockedAgentChatProps> = {};

export const ReadOnlyWhileModelCantRunHere: StoryObj<LockedAgentChatProps> = {
  args: {
    setup: {
      reason: "Coco's model, Sonnet 5.5, isn't available on this device.",
      onOpenProfile: () => {},
    },
  },
};
