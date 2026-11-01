import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentProjectHeaderProps = React.ComponentProps<typeof AgentProjectHeader>;

const meta = {
  title: "Agent Mode/Project Header",
  component: AgentProjectHeader,
  args: {
    projectName: "Product research",
    onExit: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentProjectHeaderProps>;
export default meta;

const renderHeader: StoryObj<AgentProjectHeaderProps>["render"] = (args) => (
  <TooltipProvider>
    <AgentProjectHeader
      projectName={args.projectName}
      title={args.title}
      onExit={args.onExit}
      menu={args.menu}
      orphaned={args.orphaned}
      sidebarOpen={args.sidebarOpen}
      className={args.className}
    />
  </TooltipProvider>
);

export const Default: StoryObj<AgentProjectHeaderProps> = { render: renderHeader };

export const ProjectConversation: StoryObj<AgentProjectHeaderProps> = {
  args: { title: "Compare vendor pricing" },
  render: renderHeader,
};

export const ProjectConversationLongNames: StoryObj<AgentProjectHeaderProps> = {
  args: {
    projectName: "Quarterly planning and cross-team research",
    title: "Compare vendor pricing across every region and plan tier we evaluated",
  },
  render: renderHeader,
};

export const ProjectSidebarOpen: StoryObj<AgentProjectHeaderProps> = {
  args: { sidebarOpen: true },
  render: renderHeader,
};

export const ProjectConversationSidebarOpen: StoryObj<AgentProjectHeaderProps> = {
  args: { title: "Compare vendor pricing", sidebarOpen: true },
  render: renderHeader,
};

export const GlobalConversation: StoryObj<AgentProjectHeaderProps> = {
  args: { projectName: undefined, onExit: undefined, title: "Weekly review" },
  render: renderHeader,
};
