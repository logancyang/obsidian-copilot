import React from "react";
import type { InstallState } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";
import { Terminal } from "lucide-react";
import { AgentBackendHeader, type AgentBackendHeaderProps } from "./AgentBackendHeader";

// The gallery import fence keeps backend modules out of shared stories, so the two release
// floors are restated here. Each outdated fixture sits below its floor, which is the single
// support threshold for managed and user-owned installs alike.
const OPENCODE_FLOOR = "1.18.31";
const OPENCODE_OUTDATED = "1.18.16";
const CODEX_FLOOR = "1.12.0";
const CODEX_OUTDATED = "1.10.0";

const codexOutdated = (source: "managed" | "custom"): InstallState => ({
  kind: "incompatible",
  source,
  currentVersion: CODEX_OUTDATED,
  minVersion: CODEX_FLOOR,
  message: `Codex adapter v${CODEX_OUTDATED} is not supported. Copilot requires Codex adapter v${CODEX_FLOOR} or newer.`,
});

const meta = {
  title: "Settings/Agent Backend Header",
  component: AgentBackendHeader,
  args: {
    displayName: "opencode",
    Icon: Terminal,
    installState: {
      kind: "incompatible",
      source: "managed",
      currentVersion: OPENCODE_OUTDATED,
      minVersion: OPENCODE_FLOOR,
      message: `opencode v${OPENCODE_OUTDATED} is not supported. Copilot requires opencode v${OPENCODE_FLOOR} or newer.`,
    },
    managedInstall: { kind: "idle" },
    resolvedPath: `~/.obsidian-copilot/opencode/${OPENCODE_OUTDATED}/opencode`,
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
    installState: codexOutdated("managed"),
    resolvedPath: `~/.obsidian-copilot/codex/${CODEX_OUTDATED}/codex-acp`,
  },
};
/**
 * A user-owned Codex adapter below the release floor. It reports an update rather than a
 * missing install, so the configured path survives and Configure can explain the requirement.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/480
 */
export const OutdatedCustomCodex: StoryObj<AgentBackendHeaderProps> = {
  args: {
    displayName: "Codex",
    installState: codexOutdated("custom"),
    resolvedPath: "~/.local/bin/codex-acp",
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
