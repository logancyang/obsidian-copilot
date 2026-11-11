import { AntigravityConfigView } from "@/agentMode/backends/antigravity/ui/AntigravityConfigView";
import { FullBleedReactModal } from "@/components/modals/ReactModal";
import { updateAgentModeBackendFields, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { Notice } from "obsidian";
import React from "react";
import {
  antigravityDetectionSearchDirs,
  antigravityInstallState,
  antigravitySignInCommand,
  detectAntigravityCliPath,
  resolveAntigravityBinaryPath,
} from "./antigravityCli";

const AntigravityConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const slice = settings.agentMode?.backends?.antigravity;
  const binaryPath = resolveAntigravityBinaryPath(settings);

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateAgentModeBackendFields("antigravity", { binaryPath: path });
    new Notice("Antigravity CLI path saved.");
    return null;
  }, []);

  const onClearPath = React.useCallback((): void => {
    updateAgentModeBackendFields("antigravity", { binaryPath: undefined });
    new Notice("Antigravity CLI path cleared. Auto-detection will be used.");
  }, []);

  return (
    <AntigravityConfigView
      state={antigravityInstallState(binaryPath)}
      binaryPath={binaryPath ?? ""}
      hasBinaryPathOverride={Boolean(slice?.binaryPath)}
      onSavePath={onSavePath}
      onClearPath={onClearPath}
      detect={detectAntigravityCliPath}
      searchedDirs={antigravityDetectionSearchDirs}
      signInCommand={antigravitySignInCommand(binaryPath, slice?.envOverrides, process.platform)}
      onClose={onClose}
    />
  );
};

export class AntigravityInstallModal extends FullBleedReactModal {
  protected renderContent(close: () => void): React.ReactElement {
    return <AntigravityConfigContainer onClose={close} />;
  }
}
