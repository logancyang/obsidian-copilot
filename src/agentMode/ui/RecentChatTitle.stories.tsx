import {
  RecentChatProjectBadge,
  RecentChatTitle,
  type RecentChatTitleProps,
} from "@/agentMode/ui/RecentChatTitle";
import type { Meta, StoryObj } from "@/lib/story";
import { MessageCircle } from "lucide-react";
import React from "react";

interface ChatRowFrameProps extends RecentChatTitleProps {
  projectName?: string;
  time?: string;
}

const PROJECT_TITLE = "Compare onboarding patterns";
const PROJECT_NAME = "Product research";
const OVERFLOW_TITLE =
  "Do a research on Mobbin that explains how people express their app value on the homepage";
const OVERFLOW_PROJECT_NAME = "International product research and competitive analysis";

const ChatRowFrame = ({
  title,
  projectName,
  time = "2h",
  ...props
}: ChatRowFrameProps): React.ReactElement => (
  <div className="tw-flex tw-min-h-9 tw-w-full tw-items-start tw-gap-2 tw-rounded-md tw-px-2 tw-py-1.5">
    <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted">
      <MessageCircle className="tw-size-4" />
    </span>
    <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1">
      <RecentChatTitle title={title} {...props} />
      {projectName && <RecentChatProjectBadge name={projectName} />}
    </div>
    <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5">
      <span className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted">{time}</span>
    </div>
  </div>
);

const meta = {
  title: "Agent Mode/Recent Chat Title",
  component: ChatRowFrame,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ChatRowFrameProps>;
export default meta;

/** Project ownership appears below the conversation title, apart from the timestamp. */
export const ProjectBadge: StoryObj<ChatRowFrameProps> = {
  args: {
    title: PROJECT_TITLE,
    projectName: PROJECT_NAME,
  },
  render: ({ title = PROJECT_TITLE, ...args }) => <ChatRowFrame title={title} {...args} />,
};

/** Same-prefix titles keep their distinguishing endings visible above long project names. */
export const OverflowStress: StoryObj<ChatRowFrameProps> = {
  args: {
    title: OVERFLOW_TITLE,
    projectName: OVERFLOW_PROJECT_NAME,
  },
  render: ({ title = OVERFLOW_TITLE, projectName = OVERFLOW_PROJECT_NAME, ...args }) => (
    <div className="tw-flex tw-w-full tw-flex-col tw-divide-y tw-divide-border">
      <ChatRowFrame title={title} projectName={projectName} {...args} />
      <ChatRowFrame title={`${title}: pricing and packaging`} projectName={projectName} />
      <ChatRowFrame title={`${title}: navigation and onboarding`} projectName="Research" />
      <ChatRowFrame title={title} />
    </div>
  ),
};
