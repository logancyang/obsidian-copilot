import {
  OpencodeAbsentInstallView,
  type OpencodeAbsentInstallActionsProps,
} from "@/agentMode/backends/opencode/ui/OpencodeAbsentInstallView";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Opencode Absent Install",
  component: OpencodeAbsentInstallView,
  args: {
    onInstall: () => undefined,
    onCancel: () => undefined,
    onAdoptExisting: () => undefined,
    onConfigure: () => undefined,
  },
  // `settings-tab`, because this row lives in the opencode settings panel and
  // its buttons inherit Obsidian's settings-pane chrome.
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<OpencodeAbsentInstallActionsProps>;
export default meta;

/** First run: download leads, adopting an existing binary is the quiet second. */
export const Idle: StoryObj<OpencodeAbsentInstallActionsProps> = {
  args: { state: { kind: "idle" } },
};

/** Detect in flight — both actions lock so the two cannot both write the path. */
export const Detecting: StoryObj<OpencodeAbsentInstallActionsProps> = {
  args: { state: { kind: "detecting" } },
};

export const Downloading: StoryObj<OpencodeAbsentInstallActionsProps> = {
  args: {
    state: {
      kind: "installing",
      label: "Downloading opencode-darwin-arm64.zip — 12.4 MB / 38.1 MB (32%)",
      percent: 32,
    },
  },
};

/** The label is the longest thing in the row, so it has to truncate, not wrap. */
export const DownloadingLongLabel: StoryObj<OpencodeAbsentInstallActionsProps> = {
  args: {
    state: {
      kind: "installing",
      label: "Downloading opencode-linux-x64-musl-static-with-a-very-long-asset-name.tar.gz",
      percent: 71,
    },
  },
};

/** Failure swaps the second action for Configure, since detection has nothing left to try. */
export const Failed: StoryObj<OpencodeAbsentInstallActionsProps> = {
  args: {
    state: {
      kind: "error",
      message: "Couldn't find opencode on this device. Use Configure to enter its path.",
    },
  },
};
