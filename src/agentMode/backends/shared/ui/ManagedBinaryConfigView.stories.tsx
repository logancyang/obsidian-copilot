import {
  ManagedBinaryConfigView,
  type ManagedBinarySource,
  type ManagedBinaryConfigActions,
  type ManagedBinaryConfigViewProps,
  type ManagedBinaryInfo,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import React from "react";
import type { Meta, StoryObj } from "@/lib/story";

const ACTIONS: ManagedBinaryConfigActions = {
  install: () => undefined,
  cancelInstall: () => undefined,
  uninstall: () => undefined,
  upgrade: () => undefined,
  saveCustomPath: () => Promise.resolve(null),
  clearCustomPath: () => Promise.resolve(),
  detectCustomPath: () => Promise.resolve(null),
};

const MANAGED: ManagedBinaryInfo = {
  platform: "darwin-arm64",
  version: "1.10.0",
  destination: "~/.obsidian-copilot/agent",
  run: { kind: "idle" },
};

/**
 * Every story renders through this stateful wrapper so the gallery can exercise
 * the source switch for real: `args.source` seeds the first render (keeping each
 * story's captured state), then clicking a segment swaps the visible branch.
 */
const InteractiveConfigView: React.FC<Partial<ManagedBinaryConfigViewProps>> = (props) => {
  const [source, setSource] = React.useState<ManagedBinarySource>(props.source ?? "managed");
  return (
    <ManagedBinaryConfigView
      {...(props as ManagedBinaryConfigViewProps)}
      source={source}
      onSourceChange={setSource}
    />
  );
};

const meta = {
  title: "Agent Mode/Managed Binary Config View",
  component: ManagedBinaryConfigView,
  args: {
    title: "Configure agent",
    binaryName: "agent",
    managedDescription: "Let Copilot download and manage the agent tested for this release.",
    customDescription: "Point Agent Mode at a binary you already have on disk.",
    customPathPlaceholder: "/absolute/path/to/agent",
    customPathNotFoundHint: "No agent found. Apply a custom path or choose Managed by Copilot.",
    upgradeLabel: "Upgrade to latest",
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
} satisfies Meta<ManagedBinaryConfigViewProps>;
export default meta;

export const SourceTabs: StoryObj<ManagedBinaryConfigViewProps> = { render: InteractiveConfigView };
