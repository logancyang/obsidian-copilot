import { CODEX_BINARY_NAME, codexBinaryPathPlaceholder } from "@/agentMode/backends/codex/cliSetup";
import { CODEX_ACP_MIN_VERSION } from "@/agentMode/backends/codex/codexVersion";
import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import { ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { SignInAction, type SignInActionProps } from "@/agentMode/backends/shared/ui/SignInAction";
import { AlertTriangle } from "lucide-react";
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
    <ConfigSection title="Authentication">
      {/* Sign-in needs a usable adapter; starting earlier would fail to launch it.
          https://github.com/Brevilabs/obsidian-copilot-private/issues/379 */}
      {props.state.kind === "ready" ? (
        <SignInAction {...props.auth} signInLabel="Sign in with your browser" />
      ) : (
        <div
          role="alert"
          className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-bg-callout-warning/20 tw-p-3 tw-text-sm tw-border-warning/40"
        >
          <AlertTriangle aria-hidden className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning" />
          <p className="tw-my-0">Set up a supported Codex adapter above to enable sign-in.</p>
        </div>
      )}
    </ConfigSection>
  </ManagedBinaryConfigView>
);

export { CODEX_BUNDLE_VERSION } from "@/agentMode/backends/codex/cliSetup";
