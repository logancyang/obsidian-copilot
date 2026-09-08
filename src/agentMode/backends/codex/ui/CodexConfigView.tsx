import { CODEX_BINARY_NAME, codexBinaryPathPlaceholder } from "@/agentMode/backends/codex/cliSetup";
import { CODEX_ACP_MIN_VERSION } from "@/agentMode/backends/codex/codexVersion";
import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import {
  AuthenticationSection,
  type AuthenticationState,
} from "@/agentMode/backends/shared/ui/AuthenticationSection";
import React from "react";

export type {
  ManagedBinarySource as CodexBinarySource,
  ManagedBinaryInfo as CodexManagedInfo,
  ManagedBinaryConfigActions as CodexConfigActions,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";

export interface CodexConfigViewProps extends ManagedBinaryConfigProps {
  auth: AuthenticationState;
}

export const CodexConfigView: React.FC<CodexConfigViewProps> = (props) => (
  <ManagedBinaryConfigView
    authStatus={props.auth.status}
    {...props}
    title="Configure Codex"
    binaryName={CODEX_BINARY_NAME}
    managedDescription="Let Copilot download and manage Codex."
    customDescription={
      <>
        Copilot supports <code>@agentclientprotocol/codex-acp</code> {CODEX_ACP_MIN_VERSION} or
        newer. You manage its upgrades; Auto-detect checks the usual npm locations and your PATH.
      </>
    }
    customPathPlaceholder={codexBinaryPathPlaceholder(process.platform)}
    customPathNotFoundHint={`A supported ${CODEX_BINARY_NAME} adapter was not found. Install your own adapter or choose Managed by Copilot.`}
    upgradeLabel="Upgrade"
  >
    <AuthenticationSection
      ready={props.state.kind === "ready"}
      unavailableMessage="Set up a supported Codex adapter above to enable sign-in."
      auth={props.auth}
    />
  </ManagedBinaryConfigView>
);

export { CODEX_BUNDLE_VERSION } from "@/agentMode/backends/codex/cliSetup";
