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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
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
 * Configure Claude with installation first when unavailable and account controls
 * first once installed. Completed installation remains available for diagnostics
 * and custom-path changes without competing with sign-in.
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
}) => {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  // Completed setup must not compete with sign-in; unavailable paths stay visible for recovery.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/413
  const installationRequired = state.kind !== "ready";
  const showDetails = installationRequired || detailsOpen;
  const account = (
    <AuthenticationSection
      ready={state.kind === "ready"}
      unavailableMessage="Set up Claude Code above to enable sign-in."
      auth={auth}
    />
  );
  return (
    <ConfigDialogShell
      authStatus={auth.status}
      title="Configure Claude"
      state={state}
      warning={<ConfigWarningStrip state={state} detail={claudeUpdateDetail(state)} />}
      onClose={onClose}
    >
      {!installationRequired && account}
      <Collapsible open={showDetails} onOpenChange={setDetailsOpen}>
        <ConfigSection>
          {!installationRequired && (
            <CollapsibleTrigger asChild>
              <SettingDisclosure open={showDetails} label="Installation details" />
            </CollapsibleTrigger>
          )}
          <CollapsibleContent className="tw-flex tw-flex-col tw-gap-3">
            <div className="tw-flex tw-flex-col tw-gap-2">
              <h4 className="tw-m-0 tw-text-sm tw-font-semibold">Install Claude Code</h4>
              <CommandBlock command={CLAUDE_INSTALL_COMMAND} />
            </div>
            <p className="tw-my-0 tw-text-sm tw-text-muted">
              Copilot runs Claude Code on this machine. After installing, use Auto-detect to find
              it, or enter an existing installation path.
            </p>
            <BinaryPathSetting
              binaryName="claude"
              placeholder={PATH_PLACEHOLDER}
              initialPath={binaryPath}
              hasPersistedPath={hasBinaryPathOverride}
              notFoundHint="claude not found in known install locations. Run the install command above, then click Auto-detect again."
              onSave={onSavePath}
              onClear={onClearPath}
              persistOnAutoDetect
              detect={detect}
              searchedDirs={searchedDirs}
            />
          </CollapsibleContent>
        </ConfigSection>
      </Collapsible>
      {installationRequired && account}
    </ConfigDialogShell>
  );
};
