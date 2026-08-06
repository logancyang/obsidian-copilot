import {
  OpencodeConfigView,
  type OpencodeConfigActions,
  type OpencodeConfigViewProps,
  type OpencodeManagedInfo,
} from "@/agentMode/backends/opencode/ui/OpencodeConfigView";
import { OPENCODE_PINNED_VERSION } from "@/lib/opencodeVersion";
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
  minVersion: OPENCODE_PINNED_VERSION,
  message: `opencode v0.14.2 is not supported. Copilot requires opencode v${OPENCODE_PINNED_VERSION} or newer.`,
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
export const ManagedNotInstalled: StoryObj<OpencodeConfigViewProps> = {};

export const ManagedInstalling: StoryObj<OpencodeConfigViewProps> = {
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
  args: { state: { kind: "ready", source: "managed" }, activeSource: "managed" },
};

export const CustomPathApplied: StoryObj<OpencodeConfigViewProps> = {
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
  args: { source: "custom", state: { kind: "ready", source: "managed" }, activeSource: "managed" },
};

export const OutdatedWithUpgrade: StoryObj<OpencodeConfigViewProps> = {
  args: { state: OUTDATED, activeSource: "managed" },
};
