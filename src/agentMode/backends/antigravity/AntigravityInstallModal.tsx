import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import type { InstallState } from "@/agentMode/session/types";
import { ReactModal } from "@/components/modals/ReactModal";
import { getSettings, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import {
  detectAntigravityCliPath,
  getAntigravityInstallState,
  antigravityCliDetectionSearchDirs,
  updateAntigravityFields,
} from "./descriptor";
import { CONFIG_MODAL_CLASS } from "@/agentMode/backends/shared/ui/ConfigDialogShell";

const PATH_PLACEHOLDER =
  process.platform === "win32" ? "/absolute/path/to/agy.exe" : "/absolute/path/to/agy";

const AntigravityConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const configuredPath = settings.agentMode?.backends?.antigravity?.binaryPath;
  const binaryPath = configuredPath ?? "";
  const state: InstallState = getAntigravityInstallState(getSettings());

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const error = await validateExecutableFile(path);
    if (error) return error;
    updateAntigravityFields({ binaryPath: path });
    new Notice("Antigravity CLI path saved.");
    return null;
  }, []);

  const onClearPath = React.useCallback((): void => {
    updateAntigravityFields({ binaryPath: undefined });
    new Notice("Antigravity CLI override cleared.");
  }, []);

  return (
    <ConfigDialogShell title="Configure Antigravity" state={state} onClose={onClose}>
      <ConfigSection title="Antigravity CLI">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Copilot runs the official <code>agy</code> CLI and reuses the Antigravity account login.
          See the{" "}
          <a href="https://antigravity.google/" target="_blank" rel="noopener noreferrer">
            Antigravity website
          </a>{" "}
          for installation and sign-in instructions.
        </p>
        <BinaryPathSetting
          binaryName="agy"
          placeholder={PATH_PLACEHOLDER}
          initialPath={binaryPath}
          hasPersistedPath={Boolean(configuredPath)}
          notFoundHint="agy was not found in the official local install location or PATH. Install Antigravity, sign in, then run Auto-detect."
          onSave={onSavePath}
          onClear={onClearPath}
          persistOnAutoDetect
          detect={detectAntigravityCliPath}
          searchedDirs={antigravityCliDetectionSearchDirs}
        />
      </ConfigSection>
      <ConfigSection title="Account login">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Authentication is owned by Antigravity. Copilot does not ask for or store an API key.
        </p>
      </ConfigSection>
    </ConfigDialogShell>
  );
};

/** Configure dialog for the Antigravity backend. */
export class AntigravityInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, undefined, CONFIG_MODAL_CLASS);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <AntigravityConfigContainer onClose={close} />;
  }
}
