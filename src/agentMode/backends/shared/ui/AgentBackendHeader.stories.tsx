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
      currentVersion: "1.15.0",
      minVersion: "1.16.0",
      message: "opencode v1.15.0 is not supported. Copilot requires opencode v1.16.0 or newer.",
    },
    managedInstall: { kind: "idle" },
    resolvedPath: "~/.obsidian-copilot/opencode/1.15.0/opencode",
    onConfigure: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentBackendHeaderProps>;
export default meta;
export const NotInstalled: StoryObj<AgentBackendHeaderProps> = {
  args: {
    installState: { kind: "absent" },
    resolvedPath: null,
  },
};
export const Upgrade: StoryObj<AgentBackendHeaderProps> = {};
export const OutdatedCodex: StoryObj<AgentBackendHeaderProps> = {
  args: {
    displayName: "Codex",
    installState: {
      kind: "incompatible",
      source: "managed",
      currentVersion: "0.0.44",
      minVersion: "0.0.45",
      message: "Codex adapter 0.0.44 is not supported. Copilot requires 0.0.45 or newer.",
    },
    resolvedPath: "~/.obsidian-copilot/codex/0.0.44/codex-acp",
  },
};
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
        />
      ))}
    </>
  ),
};
