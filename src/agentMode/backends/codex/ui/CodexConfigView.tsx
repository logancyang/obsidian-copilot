import {
  CODEX_AUTH_COMMAND,
  CODEX_BINARY_NAME,
  CODEX_INSTALL_COMMAND,
  codexBinaryPathPlaceholder,
} from "@/agentMode/backends/codex/cliSetup";
import { CODEX_ACP_MIN_VERSION } from "@/agentMode/backends/codex/codexVersion";
import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock, SetupStep } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { InstallState } from "@/agentMode/session/types";
import React from "react";

export interface CodexConfigViewProps {
  /** Readiness of the configured adapter; drives the header badge and the warning strip. */
  state: InstallState;
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
 * Codex exposes no sign-in capability, so its second step is the command alone —
 * `codex login` is the only way in.
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
}) => (
  <ConfigDialogShell title="Configure Codex" state={state} onClose={onClose}>
    <ConfigSection title="codex-acp adapter">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot supports <code>@agentclientprotocol/codex-acp</code> {CODEX_ACP_MIN_VERSION} or
        newer. Auto-detect checks its usual npm install locations and your PATH.
      </p>
      <BinaryPathSetting
        binaryName={CODEX_BINARY_NAME}
        placeholder={codexBinaryPathPlaceholder(process.platform)}
        initialPath={binaryPath}
        notFoundHint={`A supported ${CODEX_BINARY_NAME} adapter was not found. Run the install command below, then click Auto-detect again.`}
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>

    <ConfigSection title="Don't have it yet?">
      {/* The section's own gap sets the rhythm inside a step, so the steps need a
          wider one to read as two items rather than one run of controls. */}
      <div className="tw-flex tw-flex-col tw-gap-4">
        <SetupStep index={1} title="Install it">
          <CommandBlock command={CODEX_INSTALL_COMMAND} />
        </SetupStep>
        <SetupStep index={2} title="Sign in">
          <CommandBlock command={CODEX_AUTH_COMMAND} />
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            Copilot inherits whatever credentials the Codex CLI holds — there is no key to paste
            here.
          </p>
        </SetupStep>
      </div>
    </ConfigSection>
  </ConfigDialogShell>
);
