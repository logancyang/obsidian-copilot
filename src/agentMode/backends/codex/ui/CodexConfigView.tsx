import {
  CODEX_AUTH_COMMAND,
  CODEX_BINARY_NAME,
  codexBinaryPathPlaceholder,
} from "@/agentMode/backends/codex/cliSetup";
import { CODEX_ACP_MIN_VERSION } from "@/agentMode/backends/codex/codexVersion";
import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock, SetupStep } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { InstallState, ManagedInstallActionState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import React from "react";

export interface CodexConfigViewProps {
  /** Readiness of the configured adapter; drives the header badge and the warning strip. */
  state: InstallState;
  installRun: ManagedInstallActionState;
  onInstall: () => void;
  /** Persisted path to the ACP adapter; empty when none is configured. */
  binaryPath: string;
  /** Validate and persist a user-supplied path. Resolves to an error message, or null on success. */
  onSavePath: (path: string) => Promise<string | null>;
  /** Forget the configured path. */
  onClearPath: () => void;
  /** Look for a `codex-acp` adapter already present on this machine. */
  detect: () => Promise<string | null>;
  /** Directories `detect` looked in, listed when it finds nothing. */
  searchedDirs: () => string[];
  onClose: () => void;
}

/**
 * Configure dialog body for the Codex backend, structured like Claude's: the
 * adapter path leads, installing and signing in follow as a numbered block.
 * Copilot does not run the adapter's ACP authentication flow from this dialog,
 * so its second step signs in through the adapter CLI.
 *
 * Pure props, so the gallery and unit tests can drive every state;
 * `CodexInstallModal` supplies the settings reads, validation, and notices.
 */
export const CodexConfigView: React.FC<CodexConfigViewProps> = ({
  state,
  binaryPath,
  onSavePath,
  onClearPath,
  detect,
  searchedDirs,
  onClose,
  installRun,
  onInstall,
}) => (
  <ConfigDialogShell title="Configure Codex" state={state} onClose={onClose}>
    <ConfigSection title="My own binary">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot supports <code>@agentclientprotocol/codex-acp</code> {CODEX_ACP_MIN_VERSION} or
        newer. You manage its updates; Auto-detect checks the usual npm locations and your PATH.
      </p>
      <BinaryPathSetting
        binaryName={CODEX_BINARY_NAME}
        placeholder={codexBinaryPathPlaceholder(process.platform)}
        initialPath={binaryPath}
        notFoundHint={`A supported ${CODEX_BINARY_NAME} adapter was not found. Use Managed by Copilot below, or paste your own path.`}
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>

    <ConfigSection title="Adapter setup">
      <div className="tw-flex tw-flex-col tw-gap-4">
        <SetupStep index={1} title="Managed by Copilot">
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            Install the adapter tested for this Copilot release.
          </p>
          {installRun.kind === "error" && (
            <p className="tw-my-0 tw-text-sm tw-text-error">{installRun.message}</p>
          )}
          <Button disabled={installRun.kind === "running"} onClick={onInstall}>
            {installRun.kind === "running"
              ? `${installRun.label} ${installRun.percent}%`
              : installRun.kind === "error"
                ? "Retry"
                : state.kind === "ready"
                  ? state.source === "managed"
                    ? "Reinstall"
                    : "Switch to managed"
                  : state.kind === "incompatible"
                    ? "Update"
                    : "Download & install"}
          </Button>
        </SetupStep>
        <SetupStep index={2} title="Sign in">
          <CommandBlock command={CODEX_AUTH_COMMAND} />
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            The adapter stores the login for its bundled Codex CLI — there is no key to paste here.
          </p>
        </SetupStep>
      </div>
    </ConfigSection>
  </ConfigDialogShell>
);
