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
      currentVersion: "1.18.16",
      minVersion: "1.18.31",
      message: "opencode v1.18.16 is not supported. Copilot requires opencode v1.18.31 or newer.",
    },
    managedInstall: { kind: "idle" },
    resolvedPath: "~/.obsidian-copilot/opencode/1.18.16/opencode",
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
      currentVersion: "1.10.0",
      minVersion: "1.12.0",
      message: "Codex adapter 1.10.0 does not match this Copilot release (1.12.0).",
    },
    resolvedPath: "~/.obsidian-copilot/codex/1.10.0/codex-acp",
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
