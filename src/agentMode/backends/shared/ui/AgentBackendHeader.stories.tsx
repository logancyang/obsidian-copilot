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
      message: "Update opencode to the supported version.",
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
export const Update: StoryObj<AgentBackendHeaderProps> = {};
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
