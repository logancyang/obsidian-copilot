import {
  CodexConfigView,
  CODEX_BUNDLE_VERSION,
  type CodexBinarySource,
  type CodexConfigActions,
  type CodexConfigViewProps,
  type CodexManagedInfo,
} from "@/agentMode/backends/codex/ui/CodexConfigView";
import React from "react";
import type { InstallState } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";

const ACTIONS: CodexConfigActions = {
  install: () => undefined,
  cancelInstall: () => undefined,
  uninstall: () => undefined,
  upgrade: () => undefined,
  saveCustomPath: () => Promise.resolve(null),
  clearCustomPath: () => Promise.resolve(),
  detectCustomPath: () => Promise.resolve(null),
};

const MANAGED: CodexManagedInfo = {
  platform: "darwin-arm64",
  version: CODEX_BUNDLE_VERSION,
  destination: "~/.obsidian-copilot/codex",
  run: { kind: "idle" },
};

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "managed",
  currentVersion: "1.9.0-r1",
  minVersion: CODEX_BUNDLE_VERSION,
  message: `Codex adapter v1.9.0-r1 is not supported. Copilot requires Codex adapter v${CODEX_BUNDLE_VERSION} or newer.`,
};

/**
 * Every story renders through this stateful wrapper so the gallery can exercise
 * the source switch for real: `args.source` seeds the first render (keeping each
 * story's captured state), then clicking a segment swaps the visible branch.
 */
const InteractiveConfigView: React.FC<Partial<CodexConfigViewProps>> = (props) => {
  const [source, setSource] = React.useState<CodexBinarySource>(props.source ?? "managed");
  return (
    <CodexConfigView
      {...(props as CodexConfigViewProps)}
      source={source}
      onSourceChange={setSource}
    />
  );
};

const meta = {
  title: "Agent Mode/Codex Config View",
  component: CodexConfigView,
  args: {
    auth: { status: { signedIn: false }, onSignIn: () => undefined, signingIn: false, url: null },
    state: { kind: "absent" },
    source: "managed",
    onSourceChange: () => undefined,
    activeSource: null,
    managed: MANAGED,
    customPath: "",
    upgradeRun: { kind: "idle" },
    actions: ACTIONS,
    onClose: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CodexConfigViewProps>;
export default meta;

/** First run: nothing installed, so the managed path offers a single download. */
export const ManagedNotInstalled: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
};

export const ManagedInstalling: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
  args: {
    managed: {
      ...MANAGED,
      run: {
        kind: "running",
        label: "Installing the Codex adapter…",
        percent: 30,
      },
    },
  },
};

export const ManagedInstalled: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
  args: { state: { kind: "ready", source: "managed" }, activeSource: "managed" },
};

export const CustomPathApplied: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
  args: {
    source: "custom",
    state: { kind: "ready", source: "custom" },
    activeSource: "custom",
    customPath: "/usr/local/bin/codex-acp",
  },
};

/**
 * Looking at the custom path before setting one, while the managed binary is the
 * one actually running — the case the "in use right now" note exists for.
 */
export const CustomNotSetYet: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
  args: { source: "custom", state: { kind: "ready", source: "managed" }, activeSource: "managed" },
};

export const OutdatedWithUpgrade: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
  args: { state: OUTDATED, activeSource: "managed" },
};

export const ManagedRetry: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
  args: {
    managed: {
      ...MANAGED,
      run: {
        kind: "error",
        message: "Archive download failed. Check your connection, then retry.",
      },
    },
  },
};

export const InstallingWithCustomSelected: StoryObj<CodexConfigViewProps> = {
  render: InteractiveConfigView,
  args: {
    state: { kind: "ready", source: "custom" },
    source: "managed",
    activeSource: "custom",
    customPath: "/usr/local/bin/codex-acp",
    managed: {
      ...MANAGED,
      run: { kind: "running", label: "Installing the Codex adapter…", percent: 30 },
    },
  },
};
