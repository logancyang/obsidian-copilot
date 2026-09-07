import { CODEX_BINARY_NAME, codexBinaryPathPlaceholder } from "@/agentMode/backends/codex/cliSetup";
import { CODEX_ACP_MIN_VERSION } from "@/agentMode/backends/codex/codexVersion";
import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import { ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { SignInAction, type SignInActionProps } from "@/agentMode/backends/shared/ui/SignInAction";
import React from "react";

export type {
  ManagedBinarySource as CodexBinarySource,
  ManagedBinaryInfo as CodexManagedInfo,
  ManagedBinaryConfigActions as CodexConfigActions,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";

export interface CodexConfigViewProps extends ManagedBinaryConfigProps {
  auth: SignInActionProps;
}

export const CodexConfigView: React.FC<CodexConfigViewProps> = (props) => (
  <ManagedBinaryConfigView
    {...props}
    title="Configure Codex"
    binaryName={CODEX_BINARY_NAME}
    managedDescription="Download Codex and its runtime. No Node.js or npm installation is needed. Copilot keeps your working installation until the download is verified."
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
      {props.state.kind === "ready" ? (
        <SignInAction {...props.auth} />
      ) : (
        <p>Install Codex to sign in.</p>
      )}
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Sign in with your browser. Codex keeps your existing profile and credentials on this
        computer.
      </p>
    </ConfigSection>
  </ManagedBinaryConfigView>
);

export { CODEX_BUNDLE_VERSION } from "@/agentMode/backends/codex/cliSetup";
