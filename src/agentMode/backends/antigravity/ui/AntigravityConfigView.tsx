import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { InstallState } from "@/agentMode/session/types";
import React from "react";

export interface AntigravityConfigViewProps {
  state: InstallState;
  binaryPath: string;
  hasBinaryPathOverride: boolean;
  onSavePath: (path: string) => Promise<string | null>;
  onClearPath: () => void;
  detect: () => Promise<string | null>;
  searchedDirs: () => string[];
  signInCommand: string | null;
  onClose: () => void;
}

const PATH_PLACEHOLDER =
  process.platform === "win32" ? "/absolute/path/to/agy.exe" : "/absolute/path/to/agy";

export const AntigravityConfigView: React.FC<AntigravityConfigViewProps> = ({
  state,
  binaryPath,
  hasBinaryPathOverride,
  onSavePath,
  onClearPath,
  detect,
  searchedDirs,
  signInCommand,
  onClose,
}) => (
  <ConfigDialogShell title="Configure Antigravity" state={state} onClose={onClose}>
    <ConfigSection title="Antigravity installation">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot uses the Antigravity CLI installed on this computer. Auto-detect looks in the usual
        install locations and your PATH.
      </p>
      <BinaryPathSetting
        binaryName="agy"
        placeholder={PATH_PLACEHOLDER}
        initialPath={binaryPath}
        hasPersistedPath={hasBinaryPathOverride}
        notFoundHint="The Antigravity CLI wasn't found. Install it, then select Auto-detect again."
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>
    <ConfigSection title="Sign in">
      {signInCommand ? (
        <>
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            Run this in a terminal and finish signing in to your Google account.
          </p>
          <CommandBlock command={signInCommand} />
        </>
      ) : (
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Set up the Antigravity CLI above to sign in.
        </p>
      )}
    </ConfigSection>
  </ConfigDialogShell>
);
