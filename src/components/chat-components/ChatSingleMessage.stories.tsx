import React from "react";
import ChatSingleMessage from "./ChatSingleMessage";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import type { ChatMessage } from "@/types/message";

interface UserMessageProps {
  message: ChatMessage;
  sourcePath?: string;
}

function UserMessage({ message, sourcePath }: UserMessageProps) {
  const app = useApp();
  return (
    <TooltipProvider>
      <ChatSingleMessage
        message={message}
        sourcePath={sourcePath}
        app={app}
        isStreaming={false}
        onEdit={() => undefined}
      />
    </TooltipProvider>
  );
}

const baseMessage: ChatMessage = {
  id: "user-markdown",
  sender: "user",
  message: "",
  isVisible: true,
  timestamp: null,
};
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" rx="12" fill="#406fc6"/><text x="24" y="58" fill="white" font-size="22">Research diagram</text></svg>'
  );
const formattedText =
  "## Review the findings\n\nCompare **accuracy** and *cost*. Keep `modelId` unchanged.\n\n- Check the evidence\n- List the remaining questions\n\n> Explain what changed.\n\n```ts\nconst result = await summarize(notes);\n```";

const meta = {
  title: "Chat/User Message",
  component: UserMessage,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<UserMessageProps>;
export default meta;

export const PlainText: StoryObj<UserMessageProps> = {
  args: { message: { ...baseMessage, message: "Summarize the research findings." } },
};
export const MarkdownFormatting: StoryObj<UserMessageProps> = {
  args: { message: { ...baseMessage, message: formattedText } },
};
export const SavedImageEmbed: StoryObj<UserMessageProps> = {
  args: {
    message: {
      ...baseMessage,
      message: `**Explain this diagram.**\n\n![Research diagram](${image})`,
    },
  },
};
export const UploadedImage: StoryObj<UserMessageProps> = {
  args: {
    message: {
      ...baseMessage,
      message: "**Explain this diagram.**",
      content: [
        { type: "text", text: "**Explain this diagram.**" },
        { type: "image_url", image_url: { url: image } },
      ],
    },
  },
};
export const LongMessage: StoryObj<UserMessageProps> = {
  args: {
    message: {
      ...baseMessage,
      message: `${formattedText}\n\n${formattedText}\n\n${formattedText}`,
    },
  },
};

export const SavedNoteLink: StoryObj<UserMessageProps> = {
  args: {
    sourcePath: "Research/Conversation.md",
    message: { ...baseMessage, message: "Review [[Findings]] beside this saved conversation." },
  },
};
