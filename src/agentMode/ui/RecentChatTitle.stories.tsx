import { RecentChatTitle, type RecentChatTitleProps } from "@/agentMode/ui/RecentChatTitle";
import type { Meta, StoryObj } from "@/lib/story";
import { MessageCircle } from "lucide-react";
import React from "react";

interface ChatRowFrameProps extends RecentChatTitleProps {
  time?: string;
}

const PROJECT_TITLE = "Compare onboarding patterns";
const PROJECT_NAME = "Product research";
const OVERFLOW_TITLE =
  "Do a research on Mobbin that explains how people express their app value on the homepage";
const OVERFLOW_PROJECT_NAME = "International product research and competitive analysis";

const ChatRowFrame = ({ time = "2h", ...props }: ChatRowFrameProps): React.ReactElement => (
  <div className="tw-flex tw-min-h-9 tw-w-full tw-items-center tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5">
    <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted">
      <MessageCircle className="tw-size-4" />
    </span>
    <RecentChatTitle {...props} />
    <span className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted">{time}</span>
  </div>
);

const meta = {
  title: "Agent Mode/Recent Chat Title",
  component: RecentChatTitle,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<RecentChatTitleProps>;
export default meta;

/** Project ownership stays adjacent to the conversation title. */
export const ProjectBadge: StoryObj<RecentChatTitleProps> = {
  args: {
    title: PROJECT_TITLE,
    projectName: PROJECT_NAME,
  },
  render: ({ title = PROJECT_TITLE, ...args }) => <ChatRowFrame title={title} {...args} />,
};

/** Long titles and project names exercise independent ellipses at narrow widths. */
export const OverflowStress: StoryObj<RecentChatTitleProps> = {
  args: {
    title: OVERFLOW_TITLE,
    projectName: OVERFLOW_PROJECT_NAME,
  },
  render: ({ title = OVERFLOW_TITLE, projectName = OVERFLOW_PROJECT_NAME, ...args }) => (
    <div className="tw-flex tw-w-full tw-flex-col tw-divide-y tw-divide-border">
      <ChatRowFrame title={title} projectName={projectName} {...args} />
      <ChatRowFrame title="Homepage copy" projectName={projectName} />
      <ChatRowFrame title={title} projectName="Research" />
      <ChatRowFrame title={title} />
    </div>
  ),
};
