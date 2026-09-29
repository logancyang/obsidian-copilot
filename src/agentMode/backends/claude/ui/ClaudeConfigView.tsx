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

export type ClaudeAuthProps = AuthenticationState;

export interface ClaudeConfigViewProps {
  state: InstallState;
  binaryPath: string;
  hasBinaryPathOverride: boolean;
  onSavePath: (path: string) => Promise<string | null>;
  onClearPath: () => void;
  detect: () => Promise<string | null>;
  searchedDirs: () => string[];
  auth: ClaudeAuthProps;
  onClose: () => void;
}

const PATH_PLACEHOLDER =
  process.platform === "win32" ? "/absolute/path/to/claude.exe" : "/absolute/path/to/claude";

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
