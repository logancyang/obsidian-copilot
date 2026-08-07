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

/** The workspace header matches the project list's neutral folder treatment. */
export const Default: StoryObj<AgentProjectHeaderProps> = {
  render: (args) => (
    <TooltipProvider>
      <AgentProjectHeader
        projectName={args.projectName ?? "Product research"}
        onExit={args.onExit ?? (() => undefined)}
        menu={args.menu}
        orphaned={args.orphaned}
        className={args.className}
      />
    </TooltipProvider>
  ),
};
