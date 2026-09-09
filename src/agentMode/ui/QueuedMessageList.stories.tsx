import type { ComponentProps } from "react";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import type { Meta, StoryObj } from "@/lib/story";
const meta = {
  title: "Agent/Queued messages",
  component: QueuedMessageList,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { onRemove: () => {} },
} satisfies Meta<ComponentProps<typeof QueuedMessageList>>;
export default meta;
export const ImageOnly: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: {
    messages: [
      {
        id: "image",
        text: "",
        rawInput: "",
        promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
      },
    ],
  },
};
export const WaitingForContext: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: {
    messages: [
      {
        id: "image",
        text: "",
        rawInput: "",
        promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
        queueReason: "context",
      },
    ],
  },
};
