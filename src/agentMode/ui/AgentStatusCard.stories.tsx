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
    summary: "Very Long Local Agent Backend Name update required",
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
    summary: "Codex session error",
    tone: "error",
    message:
      "The agent could not start because its local connection closed before initialization completed. Check the backend configuration and try again.",
    action: { label: "Retry", onClick: () => undefined },
  },
};

export const ManagedUpgradeRequired: StoryObj<AgentStatusCardProps> = {
  args: {
    summary: "opencode update required",
    tone: "warning",
    message: "opencode v1.18.16 is not supported. Copilot requires opencode v1.18.31 or newer.",
    action: { label: "Configure opencode", onClick: () => undefined },
  },
};

export const ManagedUpgradeRunning: StoryObj<AgentStatusCardProps> = {
  args: {
    summary: "Updating opencode…",
    tone: "warning",
    message: "Downloading opencode-darwin-arm64.zip 42%",
    action: { label: "Configure opencode", onClick: () => undefined },
  },
};

export const ManagedUpgradeFailed: StoryObj<AgentStatusCardProps> = {
  args: {
    summary: "opencode update failed",
    tone: "error",
    message: "GitHub API rate-limited. Retry after the limit resets.",
    action: { label: "Configure opencode", onClick: () => undefined },
  },
};

export const OutdatedCodex: StoryObj<AgentStatusCardProps> = {
  args: {
    summary: "Codex update required",
    tone: "warning",
    message: "Codex adapter 1.10.0 does not match this Copilot release (1.12.0).",
    action: { label: "Configure Codex", onClick: () => undefined },
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

export const SignIn: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Codex not signed in",
    action: { label: "Sign in", onClick: () => undefined },
  },
};

export const LongPathError: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "error",
    summary: "Codex setup error",
    message:
      "Could not execute C:\\Users\\example\\AppData\\Local\\organizationworkspacewithaverylongunbrokenidentifier012345678901234567890123456789\\customagentruntime\\codex-acp.exe.\nCheck the configured binary path and executable permissions before trying again.\nEACCES: permission denied",
    action: { label: "Configure Codex", onClick: () => undefined },
  },
};

export const ConfigChangedReload: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "opencode config has changed",
    action: { label: "Reload", onClick: () => undefined },
  },
};

export const ConfigChangedReloading: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Very Long Local Agent Backend Name config has changed",
    action: { label: "Reloading…", onClick: () => undefined, disabled: true },
  },
};
