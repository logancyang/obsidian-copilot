import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type AgentStatusCardProps = React.ComponentProps<typeof AgentStatusCard>;

const meta = {
  title: "Agent Mode/Agent Status Card",
  component: AgentStatusCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentStatusCardProps>;
export default meta;

export const Checking: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Checking Very Long Local Agent Backend Name version…",
  },
};

export const InstallAction: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Very Long Local Agent Backend Name is not installed",
    action: {
      label: "Install Very Long Local Agent Backend Name",
      onClick: () => undefined,
    },
  },
};

export const IncompatibleWarning: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "warning",
    message:
      "Very Long Local Agent Backend Name 2.1.205 is not supported. Version 2.1.206 or newer is required.",
    action: {
      label: "Configure Very Long Local Agent Backend Name",
      onClick: () => undefined,
    },
  },
};

export const LongErrorRetry: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "error",
    message:
      "The agent could not start because its local connection closed before initialization completed. Check the backend configuration and try again.",
    action: { label: "Retry", onClick: () => undefined },
  },
};

export const ManagedUpdateRequired: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "warning",
    message: "opencode v1.15.0 is not supported. Copilot requires opencode v1.16.0 or newer.",
    action: { label: "Update", onClick: () => undefined },
  },
};

export const ManagedUpdateRunning: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "warning",
    message: "Downloading opencode-darwin-arm64.zip 42%",
    action: { label: "Upgrading…", onClick: () => undefined, disabled: true },
  },
};

export const ManagedUpdateFailed: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "error",
    message: "GitHub API rate-limited. Retry after the limit resets.",
    action: { label: "Retry", onClick: () => undefined },
  },
};

export const LinkedSignIn: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Signing in to Very Long Local Agent Backend Name…",
    action: {
      label: "Open sign-in page",
      href: "https://example.com/sign-in",
    },
  },
};
