import { AntigravityConfigView } from "@/agentMode/backends/antigravity/ui/AntigravityConfigView";
import { binaryPathInstallState } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { FullBleedReactModal } from "@/components/modals/ReactModal";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import {
  antigravityDetectionSearchDirs,
  detectAntigravityPath,
  updateAntigravityFields,
} from "./descriptor";

const AntigravityConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const binaryPath = settings.agentMode?.backends?.antigravity?.binaryPath ?? "";

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
      state={binaryPathInstallState(binaryPath)}
      binaryPath={binaryPath}
      onSavePath={onSavePath}
      onClearPath={onClearPath}
      detect={detectAntigravityPath}
      searchedDirs={antigravityDetectionSearchDirs}
      onClose={onClose}
    />
  );
};

export class AntigravityInstallModal extends FullBleedReactModal {
  constructor(app: App) {
    super(app);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <AntigravityConfigContainer onClose={close} />;
  }
}
