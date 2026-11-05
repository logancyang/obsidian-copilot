import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import { List } from "lucide-react";
import React from "react";

type AgentProjectHeaderProps = React.ComponentProps<typeof AgentProjectHeader>;

const meta = {
  title: "Agent Mode/Project Header",
  component: AgentProjectHeader,
  args: {
    projectName: "Product research",
    onExit: () => undefined,
    onOpenSettings: () => undefined,
    onRevealFolder: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentProjectHeaderProps>;
export default meta;

const renderHeader: StoryObj<AgentProjectHeaderProps>["render"] = (args) => (
  <TooltipProvider>
    <AgentProjectHeader
      projectName={args.projectName ?? "Product research"}
      onExit={args.onExit ?? (() => undefined)}
      onOpenSettings={args.onOpenSettings}
      onRevealFolder={args.onRevealFolder}
      menu={args.menu}
      isProjectHome={args.isProjectHome}
      orphaned={args.orphaned}
      canLeaveProject={args.canLeaveProject}
      className={args.className}
    />
  </TooltipProvider>
);

const popoverTrigger = (
  <Button
    variant="ghost2"
    size="icon"
    aria-label="Project info for Product research"
    className="tw-size-7 tw-text-muted hover:tw-text-normal"
  >
    <List className="tw-size-4" />
  </Button>
);

export const ProjectHome: StoryObj<AgentProjectHeaderProps> = {
  args: { menu: popoverTrigger, isProjectHome: true },
  render: renderHeader,
};

export const InChat: StoryObj<AgentProjectHeaderProps> = {
  args: { menu: popoverTrigger },
  render: renderHeader,
};

export const LongNameInChat: StoryObj<AgentProjectHeaderProps> = {
  args: {
    projectName: "Comparative analysis of retrieval strategies across vault sizes",
    menu: popoverTrigger,
  },
  render: renderHeader,
};

export const Orphaned: StoryObj<AgentProjectHeaderProps> = {
  args: { orphaned: true },
  render: renderHeader,
};

export const ProjectCannotLeave: StoryObj<AgentProjectHeaderProps> = {
  args: { canLeaveProject: false },
  render: renderHeader,
};
