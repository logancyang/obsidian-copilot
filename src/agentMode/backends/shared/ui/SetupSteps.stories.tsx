import {
  CommandBlock,
  SetupStep,
  type CommandShell,
} from "@/agentMode/backends/shared/ui/SetupSteps";
import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

interface SetupStepsStoryProps {
  /** Command in the first step, so the overflow case can push a long one through. */
  installCommand: string;
  /** Extra control beside Copy on the sign-in command. */
  action?: React.ReactNode;
  /** Prompt convention for the platform whose commands the story renders. */
  shell?: CommandShell;
}

/** The two-step "don't have it yet" block the CLI dialogs compose. */
const SetupStepsBlock: React.FC<SetupStepsStoryProps> = ({ installCommand, action, shell }) => (
  <div className="tw-flex tw-flex-col tw-gap-4">
    <SetupStep index={1} title="Install it">
      <CommandBlock command={installCommand} shell={shell} />
    </SetupStep>
    <SetupStep index={2} title="Sign in">
      <CommandBlock command="claude auth login --claudeai" shell={shell} action={action} />
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

/** The command-only pair, as Codex renders it. */
export const CommandsOnly: StoryObj<SetupStepsStoryProps> = {};

/** With the in-app alternative to the sign-in command, as Claude renders it. */
export const WithInAppAction: StoryObj<SetupStepsStoryProps> = {
  args: {
    action: (
      <Button variant="secondary" size="sm">
        Sign in
      </Button>
    ),
  },
};

/** A one-liner installer that has to wrap without pushing Copy out of reach. */
export const LongCommand: StoryObj<SetupStepsStoryProps> = {
  args: {
    installCommand:
      "irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex",
    shell: "powershell",
  },
};
