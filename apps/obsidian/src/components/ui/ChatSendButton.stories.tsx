import type { ComponentProps } from "react";
import { ChatSendButton } from "@/components/ui/ChatSendButton";
import type { Meta, StoryObj } from "@/lib/story";
const meta = {
  title: "Chat/Send button",
  component: ChatSendButton,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { inputMessage: "", imageCount: 0, onSend: () => {} },
} satisfies Meta<ComponentProps<typeof ChatSendButton>>;
export default meta;
export const Empty: StoryObj<ComponentProps<typeof ChatSendButton>> = {};
export const ImageOnly: StoryObj<ComponentProps<typeof ChatSendButton>> = {
  args: { imageCount: 1 },
};
