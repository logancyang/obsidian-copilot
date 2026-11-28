import type { ComponentProps } from "react";
import { ChatSendButton } from "@/components/ui/ChatSendButton";
import type { Meta, StoryObj } from "@/lib/story";
const meta = {
  title: "Chat/Send button",
  component: ChatSendButton,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { canSend: false, onSend: () => {} },
} satisfies Meta<ComponentProps<typeof ChatSendButton>>;
export default meta;
export const Empty: StoryObj<ComponentProps<typeof ChatSendButton>> = {};
export const Ready: StoryObj<ComponentProps<typeof ChatSendButton>> = {
  args: { canSend: true },
};
