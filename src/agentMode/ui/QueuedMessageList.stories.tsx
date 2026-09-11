import type { ComponentProps } from "react";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import type { AgentQueuedTask } from "@/agentMode/session/AgentTaskCoordinator";
import type { Meta, StoryObj } from "@/lib/story";

const imageOnlyTask = (queueReason: AgentQueuedTask["queueReason"]): AgentQueuedTask => ({
  taskId: "task-image",
  queueReason,
  submission: {
    submissionId: "submission-image",
    conversationId: "chat-1",
    sourceMessageIds: [],
    source: "typed",
    presentation: "text",
    requestText: "",
    rawInput: "",
    promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
  },
});

const meta = {
  title: "Agent/Queued messages",
  component: QueuedMessageList,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { onRemove: () => {} },
} satisfies Meta<ComponentProps<typeof QueuedMessageList>>;
export default meta;
export const ImageOnly: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: { tasks: [imageOnlyTask("busy")] },
};
export const WaitingForContext: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: { tasks: [imageOnlyTask("context")] },
};
