import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigViewProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import React from "react";

export type {
  ManagedBinarySource as OpencodeBinarySource,
  ManagedBinaryRunState as OpencodeRunState,
  ManagedBinaryInfo as OpencodeManagedInfo,
  ManagedBinaryConfigActions as OpencodeConfigActions,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";

export type OpencodeConfigViewProps = Pick<
  ManagedBinaryConfigViewProps,
  | "state"
  | "source"
  | "onSourceChange"
  | "activeSource"
  | "managed"
  | "customPath"
  | "upgradeRun"
  | "actions"
  | "onClose"
>;

export const OpencodeConfigView: React.FC<OpencodeConfigViewProps> = (props) => (
  <ManagedBinaryConfigView
    {...props}
    title="Configure opencode"
    binaryName="opencode"
    managedDescription="Let Copilot download and manage the official opencode binary from its GitHub repo."
    customDescription="Point Agent Mode at a binary you already have on disk. Useful for self-builders or air-gapped machines."
    customPathPlaceholder="/absolute/path/to/opencode"
    customPathNotFoundHint="opencode not found. Install it natively (`~/.opencode/bin/opencode[.exe]`), via bun/npm, or paste a custom path manually."
    upgradeLabel={props.activeSource === "custom" ? "Run opencode upgrade" : "Upgrade to latest"}
  />
);
