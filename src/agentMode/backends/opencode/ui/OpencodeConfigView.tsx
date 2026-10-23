import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import React from "react";

export type {
  ManagedBinarySource as OpencodeBinarySource,
  ManagedBinaryRunState as OpencodeRunState,
  ManagedBinaryInfo as OpencodeManagedInfo,
  ManagedBinaryConfigActions as OpencodeConfigActions,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";

export type OpencodeConfigViewProps = ManagedBinaryConfigProps;

export const OpencodeConfigView: React.FC<OpencodeConfigViewProps> = (props) => (
  <ManagedBinaryConfigView
    {...props}
    title="Configure OpenCode"
    binaryName="opencode"
    managedDescription="Let Copilot download and update OpenCode for you."
    customDescription="Use an OpenCode installation you already have on this computer."
    customPathPlaceholder="/absolute/path/to/opencode"
    customPathNotFoundHint="OpenCode wasn't found. Install it, or paste the path to an existing installation."
    upgradeLabel={
      props.activeSource === "custom" ? "Update OpenCode" : `Update to v${props.managed.version}`
    }
  />
);
