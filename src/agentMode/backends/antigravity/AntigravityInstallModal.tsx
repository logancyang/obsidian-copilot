import { AntigravityConfigView } from "@/agentMode/backends/antigravity/ui/AntigravityConfigView";
import { binaryPathInstallState } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { CONFIG_MODAL_CLASS } from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { ReactModal } from "@/components/modals/ReactModal";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import {
  antigravityAcpDetectionSearchDirs,
  detectAntigravityAcpPath,
  updateAntigravityFields,
} from "./descriptor";

const AntigravityConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const binaryPath = settings.agentMode?.backends?.antigravity?.binaryPath ?? "";
  const state = binaryPathInstallState(binaryPath);

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateAntigravityFields({ binaryPath: path });
    new Notice("Antigravity binary path saved.");
    return null;
  }, []);

  const onClearPath = React.useCallback((): void => {
    updateAntigravityFields({ binaryPath: undefined });
    new Notice("Antigravity binary path cleared.");
  }, []);

  return (
    <AntigravityConfigView
      state={state}
      binaryPath={binaryPath}
      onSavePath={onSavePath}
      onClearPath={onClearPath}
      detect={detectAntigravityAcpPath}
      searchedDirs={antigravityAcpDetectionSearchDirs}
      onClose={onClose}
    />
  );
};

export class AntigravityInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, undefined, CONFIG_MODAL_CLASS);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <AntigravityConfigContainer onClose={close} />;
  }
}
