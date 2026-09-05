import {
  CODEX_AUTH_COMMAND,
  CODEX_BINARY_NAME,
  codexBinaryPathPlaceholder,
} from "@/agentMode/backends/codex/cliSetup";
import { CODEX_ACP_MIN_VERSION } from "@/agentMode/backends/codex/codexVersion";
import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigViewProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import { ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock } from "@/agentMode/backends/shared/ui/SetupSteps";
import React from "react";

export type {
  ManagedBinarySource as CodexBinarySource,
  ManagedBinaryRunState as CodexRunState,
  ManagedBinaryInfo as CodexManagedInfo,
  ManagedBinaryConfigActions as CodexConfigActions,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";

export type CodexConfigViewProps = Pick<
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
  | "searchedDirs"
>;

export const CodexConfigView: React.FC<CodexConfigViewProps> = (props) => (
  <ManagedBinaryConfigView
    {...props}
    title="Configure Codex"
    binaryName={CODEX_BINARY_NAME}
    managedDescription="Let Copilot download and manage the Codex adapter tested for this release."
    customDescription={
      <>
        Copilot supports <code>@agentclientprotocol/codex-acp</code> {CODEX_ACP_MIN_VERSION} or
        newer. You manage its updates; Auto-detect checks the usual npm locations and your PATH.
      </>
    }
    customPathPlaceholder={codexBinaryPathPlaceholder(process.platform)}
    customPathNotFoundHint={`A supported ${CODEX_BINARY_NAME} adapter was not found. Install your own adapter or choose Managed by Copilot.`}
    upgradeLabel="Update"
  >
    <ConfigSection title="Sign in">
      <CommandBlock command={CODEX_AUTH_COMMAND} />
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        The adapter stores the login for its bundled Codex CLI — there is no key to paste here.
      </p>
    </ConfigSection>
  </ManagedBinaryConfigView>
);
