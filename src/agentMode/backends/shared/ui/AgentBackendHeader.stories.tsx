import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { Terminal } from "lucide-react";
import { AgentBackendHeader, type AgentBackendHeaderProps } from "./AgentBackendHeader";

const meta = {
  title: "Settings/Agent Backend Header",
  component: AgentBackendHeader,
  args: {
    displayName: "opencode",
    Icon: Terminal,
    installState: {
      kind: "incompatible",
      source: "managed",
      currentVersion: "1.0.0",
      minVersion: "2.0.0",
      message: "Upgrade opencode to the supported version.",
    },
    managedInstall: { kind: "idle" },
    canUpdate: true,
    resolvedPath: "~/.obsidian-copilot/opencode/1.0.0/opencode",
    onUpdate: () => {},
    onConfigure: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentBackendHeaderProps>;
export default meta;
export const NotInstalled: StoryObj<AgentBackendHeaderProps> = {
  args: {
    installState: { kind: "absent" },
    canUpdate: false,
    resolvedPath: null,
  },
};
export const Upgrade: StoryObj<AgentBackendHeaderProps> = {};
export const Running: StoryObj<AgentBackendHeaderProps> = {
  args: { managedInstall: { kind: "running", label: "Downloading opencode.zip (42%)" } },
};
export const Indeterminate: StoryObj<AgentBackendHeaderProps> = {
  args: { managedInstall: { kind: "running", label: "Downloading opencode.zip" } },
};
export const Retry: StoryObj<AgentBackendHeaderProps> = {
  args: {
    managedInstall: {
      kind: "error",
      message: "The download failed. Check your connection and retry.",
    },
  },
};

export const SignInRequired: StoryObj<AgentBackendHeaderProps> = {
  args: {
    displayName: "Codex",
    installState: { kind: "ready", source: "managed" },
    authStatus: { signedIn: false },
    canUpdate: false,
    resolvedPath: null,
  },
};
export const CheckingSignIn: StoryObj<AgentBackendHeaderProps> = {
  args: { ...SignInRequired.args, authStatus: null },
};
export const SignedIn: StoryObj<AgentBackendHeaderProps> = {
  args: { ...SignInRequired.args, authStatus: { signedIn: true } },
};

export const InstalledPaths: StoryObj<AgentBackendHeaderProps> = {
  render: () => (
    <>
      {[
        {
          displayName: "opencode",
          resolvedPath: "~/.local/share/copilot/binaries/opencode/1.2.3/opencode",
        },
        { displayName: "Claude", resolvedPath: "/usr/local/bin/claude" },
        {
          displayName: "Codex",
          resolvedPath: "~/.local/share/copilot/binaries/codex/1.2.3/node_modules/.bin/codex-acp",
        },
      ].map((backend) => (
        <AgentBackendHeader
          key={backend.displayName}
          {...meta.args}
          {...backend}
          installState={{ kind: "ready", source: "managed" }}
          authStatus={{ signedIn: true }}
          canUpdate={false}
        />
      ))}
    </>
  ),
};
