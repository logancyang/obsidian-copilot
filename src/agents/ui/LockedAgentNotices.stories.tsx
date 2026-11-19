import { LockedAgentChat, type LockedAgentChatProps } from "@/agents/ui/LockedAgentNotices";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Custom Agents/Locked Agent Chat",
  component: LockedAgentChat,
  args: { name: "Coco", lapsed: true, onNewChat: () => {}, onUnlock: () => {} },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<LockedAgentChatProps>;
export default meta;

export const ReadOnlyAfterLicenseLapsed: StoryObj<LockedAgentChatProps> = {};

export const ReadOnlyOnDeviceWithoutLicense: StoryObj<LockedAgentChatProps> = {
  args: { lapsed: false },
};

export const ReadOnlyWhileModelCantRunHere: StoryObj<LockedAgentChatProps> = {
  args: {
    lapsed: false,
    setup: {
      reason: "Coco's model, Sonnet 5.5, isn't available on this device.",
      onOpenProfile: () => {},
    },
  },
};
