import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import type { Meta, StoryObj } from "@/lib/story";
import { Folder, MessageSquare } from "lucide-react";
import React from "react";

type AgentHomeShelfProps = React.ComponentProps<typeof AgentHomeShelf>;

const sections: AgentHomeShelfSection[] = [
  {
    id: "chats",
    icon: <MessageSquare className="tw-size-4" />,
    title: "Recent Chats",
    renderBody: () => (
      <div className="tw-flex tw-flex-col tw-gap-2 tw-p-3 tw-text-ui-small tw-text-muted">
        <span>Project launch notes</span>
        <span>Weekly review</span>
        <span>Reading list cleanup</span>
      </div>
    ),
  },
  {
    id: "projects",
    icon: <Folder className="tw-size-4" />,
    title: "Projects",
    count: 3,
    renderBody: () => <div className="tw-p-3 tw-text-ui-small tw-text-muted">Projects</div>,
  },
];

const meta = {
  title: "Agent Mode/Agent Home Shelf",
  component: AgentHomeShelf,
  args: { sections },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentHomeShelfProps>;
export default meta;

/** Recent Chats omits its unbounded history total; Projects keeps its useful tally. */
export const Default: StoryObj<AgentHomeShelfProps> = {};
