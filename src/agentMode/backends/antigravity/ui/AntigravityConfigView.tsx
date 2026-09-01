import {
  ANTIGRAVITY_AUTH_COMMAND,
  ANTIGRAVITY_BINARY_NAME,
  ANTIGRAVITY_INSTALL_COMMAND,
  antigravityBinaryPathPlaceholder,
} from "@/agentMode/backends/antigravity/cliSetup";
import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock, SetupStep } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { InstallState } from "@/agentMode/session/types";
import React from "react";

export interface AntigravityConfigViewProps {
  state: InstallState;
  binaryPath: string;
  onSavePath: (path: string) => Promise<string | null>;
  onClearPath: () => void;
  detect: () => Promise<string | null>;
  searchedDirs: () => string[];
  onClose: () => void;
}

export const AntigravityConfigView: React.FC<AntigravityConfigViewProps> = ({
  state,
  binaryPath,
  onSavePath,
  onClearPath,
  detect,
  searchedDirs,
  onClose,
}) => (
  <ConfigDialogShell title="Configure Antigravity" state={state} onClose={onClose}>
    <ConfigSection title="antigravity-acp binary">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot spawns the <code>{ANTIGRAVITY_BINARY_NAME}</code> adapter on this machine.
      </p>
      <BinaryPathSetting
        binaryName={ANTIGRAVITY_BINARY_NAME}
        placeholder={antigravityBinaryPathPlaceholder(process.platform)}
        initialPath={binaryPath}
        notFoundHint={`${ANTIGRAVITY_BINARY_NAME} not found. Run the install command below, then click Auto-detect again.`}
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>

    <ConfigSection title="Don't have it yet?">
      <div className="tw-flex tw-flex-col tw-gap-4">
        <SetupStep index={1} title="Install it">
          <CommandBlock command={ANTIGRAVITY_INSTALL_COMMAND} />
        </SetupStep>
        <SetupStep index={2} title="Sign in">
          <CommandBlock command={ANTIGRAVITY_AUTH_COMMAND} />
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            Copilot inherits whatever credentials the Antigravity CLI holds.
          </p>
        </SetupStep>
      </div>
    </ConfigSection>
  </ConfigDialogShell>
);
