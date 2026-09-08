import { CLAUDE_INSTALL_COMMAND } from "@/agentMode/backends/claude/cliSetup";
import { claudeUpdateDetail } from "@/agentMode/backends/claude/claudeUpdateDetail";
import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { InstallState } from "@/agentMode/session/types";
import {
  AuthenticationSection,
  type AuthenticationState,
} from "@/agentMode/backends/shared/ui/AuthenticationSection";
import React from "react";

/** In-app equivalent of the sign-in command, for backends that can run it themselves. */
export type ClaudeAuthProps = AuthenticationState;

export interface ClaudeConfigViewProps {
  /** Readiness of the resolved CLI; drives the header badge and the warning strip. */
  state: InstallState;
  /** Resolved CLI path shown in the leading field; empty when no binary is available. */
  binaryPath: string;
  /** Whether `binaryPath` is a persisted override rather than an auto-detected path. */
  hasBinaryPathOverride: boolean;
  /** Validate and persist a user-supplied path. Resolves to an error message, or null on success. */
  onSavePath: (path: string) => Promise<string | null>;
  /** Forget the override and fall back to auto-detection. */
  onClearPath: () => void;
  /** Look for a `claude` CLI already present on this machine. */
  detect: () => Promise<string | null>;
  /** Directories `detect` looked in, listed when it finds nothing. */
  searchedDirs: () => string[];
  /** In-app equivalent of the CLI's sign-in command. */
  auth: ClaudeAuthProps;
  onClose: () => void;
}

const PATH_PLACEHOLDER =
  process.platform === "win32" ? "/absolute/path/to/claude.exe" : "/absolute/path/to/claude";

/**
 * Configure dialog body for the Claude backend. Leads with the one field that
 * makes the agent work, where the `claude` CLI is, followed by installation
 * instructions and shared account controls. There is no
 * managed install: an unsupported auto-detected version is fixed by re-running
 * the install command, while a custom-path install must be updated in place or
 * cleared. Neither case offers an in-dialog upgrade.
 *
 * Pure props, so the gallery and unit tests can drive every state;
 * `ClaudeInstallModal` supplies the settings reads, validation, and notices.
 */
export const ClaudeConfigView: React.FC<ClaudeConfigViewProps> = ({
  state,
  binaryPath,
  hasBinaryPathOverride,
  onSavePath,
  onClearPath,
  detect,
  searchedDirs,
  auth,
  onClose,
}) => (
  <ConfigDialogShell
    authStatus={auth.status}
    title="Configure Claude"
    state={state}
    warning={<ConfigWarningStrip state={state} detail={claudeUpdateDetail(state)} />}
    onClose={onClose}
  >
    <ConfigSection title="Claude Code binary">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot runs the <code>claude</code> CLI on this machine. Auto-detect checks the usual
        install locations.
      </p>
      <BinaryPathSetting
        binaryName="claude"
        placeholder={PATH_PLACEHOLDER}
        initialPath={binaryPath}
        hasPersistedPath={hasBinaryPathOverride}
        notFoundHint="claude not found in known install locations. Run the install command below, then click Auto-detect again."
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>

    <ConfigSection title="Install Claude Code">
      <CommandBlock command={CLAUDE_INSTALL_COMMAND} />
    </ConfigSection>
    <AuthenticationSection
      ready={state.kind === "ready"}
      unavailableMessage="Set up a supported Claude CLI above to enable sign-in."
      auth={auth}
    />
  </ConfigDialogShell>
);
