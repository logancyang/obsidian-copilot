import { CURSOR_INSTALL_COMMAND } from "@/agentMode/backends/cursor/cliSetup";
import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  AuthenticationSection,
  type AuthenticationState,
} from "@/agentMode/backends/shared/ui/AuthenticationSection";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { InstallState } from "@/agentMode/session/types";
import React from "react";

export type CursorAuthProps = AuthenticationState;

export interface CursorConfigViewProps {
  state: InstallState;
  binaryPath: string;
  hasBinaryPathOverride: boolean;
  onSavePath: (path: string) => Promise<string | null>;
  onClearPath: () => void;
  detect: () => Promise<string | null>;
  searchedDirs: () => string[];
  auth: CursorAuthProps;
  onClose: () => void;
}

const PATH_PLACEHOLDER =
  process.platform === "win32" ? "/absolute/path/to/agent.exe" : "/absolute/path/to/agent";

export const CursorConfigView: React.FC<CursorConfigViewProps> = ({
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
    title="Configure Cursor"
    state={state}
    authStatus={auth.status}
    onClose={onClose}
  >
    <ConfigSection title="Cursor installation">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot uses the Cursor agent installed on this computer. Auto-detect looks in the usual
        install locations.
      </p>
      <BinaryPathSetting
        binaryName="agent"
        placeholder={PATH_PLACEHOLDER}
        initialPath={binaryPath}
        hasPersistedPath={hasBinaryPathOverride}
        notFoundHint="Cursor wasn't found. Install it with the command below, then select Auto-detect again."
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>

    <ConfigSection title="Install Cursor">
      <CommandBlock command={CURSOR_INSTALL_COMMAND} />
    </ConfigSection>
    <AuthenticationSection
      ready={state.kind === "ready"}
      unavailableMessage="Set up Cursor above to sign in."
      auth={auth}
    />
  </ConfigDialogShell>
);
