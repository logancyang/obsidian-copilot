import {
  CommandBlock,
  SetupStep,
  type CommandShell,
} from "@/agentMode/backends/shared/ui/SetupSteps";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

interface SetupStepsStoryProps {
  installCommand: string;
  shell?: CommandShell;
}

const SetupStepsBlock: React.FC<SetupStepsStoryProps> = ({ installCommand, shell }) => (
  <div className="tw-flex tw-flex-col tw-gap-4">
    <SetupStep index={1} title="Install it">
      <CommandBlock command={installCommand} shell={shell} />
    </SetupStep>
    <SetupStep index={2} title="Sign in">
      <CommandBlock command="claude auth login --claudeai" shell={shell} />
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot inherits whatever credentials the Claude Code CLI holds — there is no key to paste
        here.
      </p>
    </SetupStep>
  </div>
);

const meta = {
  title: "Agent Mode/Setup Steps",
  component: SetupStepsBlock,
  args: { installCommand: "npm install -g @anthropic-ai/claude-code" },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<SetupStepsStoryProps>;
export default meta;

export const CommandsOnly: StoryObj<SetupStepsStoryProps> = {};

export const LongCommand: StoryObj<SetupStepsStoryProps> = {
  args: {
    installCommand:
      "irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex",
    shell: "powershell",
  },
};
