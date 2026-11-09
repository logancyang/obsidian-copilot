import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { ChatTranscriptViewport } from "@/components/chat-components/ui/ChatTranscriptViewport";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentMarkdownTextProps = React.ComponentProps<typeof AgentMarkdownText>;

const BURSTS = [
  "I checked your ",
  "**Weekly review** note and the three project notes it links to. ",
  "Two tasks are overdue: the budget draft and the venue booking. ",
  "The budget draft is blocked on numbers from `Finance/Q3.md`, ",
  "so I suggest starting with the venue booking, which only needs a confirmation email.\n\n",
  "- Confirm the venue for August 14\n",
  "- Ask Finance for the Q3 numbers\n",
  "- Move the budget draft to next week",
];
const BURST_INTERVAL_MS = 400;

interface StreamingReplyDemoProps {
  bursts?: string[];
}

const StreamingReplyDemo: React.FC<StreamingReplyDemoProps> = ({ bursts = BURSTS }) => {
  const app = useApp();
  const [received, setReceived] = React.useState(1);
  const [run, setRun] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(
      () => setReceived((count) => Math.min(count + 1, bursts.length)),
      BURST_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [run, bursts]);
  const streaming = received < bursts.length;
  return (
    <div className="tw-flex tw-flex-col tw-items-start tw-gap-2">
      <AgentMarkdownText
        app={app}
        text={bursts.slice(0, received).join("")}
        streaming={streaming}
      />
      <Button
        variant="secondary"
        disabled={streaming}
        onClick={() => {
          setReceived(1);
          setRun((n) => n + 1);
        }}
      >
        Replay
      </Button>
    </div>
  );
};

const FinishedReplyDemo: React.FC = () => {
  const app = useApp();
  return <AgentMarkdownText app={app} text={BURSTS.join("")} />;
};

const meta = {
  title: "Agent Mode/Agent Markdown Text",
  component: AgentMarkdownText,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentMarkdownTextProps>;
export default meta;

export const StreamingReply: StoryObj<AgentMarkdownTextProps> = {
  render: () => <StreamingReplyDemo />,
};

export const FinishedReply: StoryObj<AgentMarkdownTextProps> = {
  render: FinishedReplyDemo,
};

const TABLE_BURSTS = [
  "Project summary\n\n| Project | Last updated |\n",
  "|---|---|\n| docs-site | Nov 9 |\n",
  "| example-long-project-name | Nov",
  " 5 |\n",
  "| portal | Nov 1 |\n\n",
  "All projects are up to date.",
];

export const StreamingTable: StoryObj<AgentMarkdownTextProps> = {
  render: () => (
    <div className="tw-flex tw-h-96 tw-flex-col">
      <ChatTranscriptViewport
        scrollContainerRef={() => undefined}
        contentRef={() => undefined}
        onScroll={() => undefined}
        isScrollPaused={false}
        scrollToEnd={() => undefined}
      >
        <StreamingReplyDemo bursts={TABLE_BURSTS} />
      </ChatTranscriptViewport>
    </div>
  ),
};
