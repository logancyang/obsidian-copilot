import {
  OpencodeConfigView,
  type OpencodeBinarySource,
  type OpencodeConfigActions,
  type OpencodeConfigViewProps,
  type OpencodeManagedInfo,
} from "@/agentMode/backends/opencode/ui/OpencodeConfigView";
import React from "react";
import {
  OPENCODE_MIN_ACP_VERSION,
  OPENCODE_PINNED_VERSION,
} from "@/agentMode/backends/opencode/ui/opencodeVersion";
import type { InstallState } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";

const ACTIONS: OpencodeConfigActions = {
  install: () => undefined,
  cancelInstall: () => undefined,
  uninstall: () => undefined,
  upgrade: () => undefined,
  saveCustomPath: () => Promise.resolve(null),
  clearCustomPath: () => Promise.resolve(),
  detectCustomPath: () => Promise.resolve(null),
};

const MANAGED: OpencodeManagedInfo = {
  platform: "darwin-arm64",
  version: OPENCODE_PINNED_VERSION,
  destination: "~/.obsidian-copilot/opencode",
  run: { kind: "idle" },
};

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "managed",
  currentVersion: "0.14.2",
  minVersion: OPENCODE_MIN_ACP_VERSION,
  message: `opencode v0.14.2 is not supported. Copilot requires opencode v${OPENCODE_MIN_ACP_VERSION} or newer.`,
};

/**
 * Every story renders through this stateful wrapper so the gallery can exercise
 * the source switch for real: `args.source` seeds the first render (keeping each
 * story's captured state), then clicking a segment swaps the visible branch.
 */
const InteractiveConfigView: React.FC<Partial<OpencodeConfigViewProps>> = (props) => {
  const [source, setSource] = React.useState<OpencodeBinarySource>(props.source ?? "managed");
  return (
    <OpencodeConfigView
      {...(props as OpencodeConfigViewProps)}
      source={source}
      onSourceChange={setSource}
    />
  );
};

const meta = {
  title: "Agent Mode/Opencode Config View",
  component: OpencodeConfigView,
  args: {
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
} satisfies Meta<OpencodeConfigViewProps>;
export default meta;

/** First run: nothing installed, so the managed path offers a single download. */
export const ManagedNotInstalled: StoryObj<OpencodeConfigViewProps> = {
  render: InteractiveConfigView,
};

export const ManagedInstalling: StoryObj<OpencodeConfigViewProps> = {
  render: InteractiveConfigView,
  args: {
    managed: {
      ...MANAGED,
      run: {
        kind: "running",
        label: "Downloading opencode-darwin-arm64.zip — 12.4 MB / 41.0 MB (30%)",
        percent: 30,
      },
    },
  },
};

export const ManagedInstalled: StoryObj<OpencodeConfigViewProps> = {
  render: InteractiveConfigView,
  args: { state: { kind: "ready", source: "managed" }, activeSource: "managed" },
};

export const CustomPathApplied: StoryObj<OpencodeConfigViewProps> = {
  render: InteractiveConfigView,
  args: {
    source: "custom",
    state: { kind: "ready", source: "custom" },
    activeSource: "custom",
    customPath: "/opt/homebrew/bin/opencode",
  },
};

/**
 * Looking at the custom path before setting one, while the managed binary is the
 * one actually running — the case the "in use right now" note exists for.
 */
export const CustomNotSetYet: StoryObj<OpencodeConfigViewProps> = {
  render: InteractiveConfigView,
  args: { source: "custom", state: { kind: "ready", source: "managed" }, activeSource: "managed" },
};

export const OutdatedWithUpgrade: StoryObj<OpencodeConfigViewProps> = {
  render: InteractiveConfigView,
  args: { state: OUTDATED, activeSource: "managed" },
};
