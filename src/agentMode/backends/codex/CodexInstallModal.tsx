import { CodexConfigView } from "@/agentMode/backends/codex/ui/CodexConfigView";
import { binaryPathInstallState } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { ReactModal } from "@/components/modals/ReactModal";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import { codexAcpDetectionSearchDirs, detectCodexAcpPath, updateCodexFields } from "./descriptor";

/**
 * Stateful half of the Codex Configure dialog: the only place that reads
 * settings, validates a pasted path, and raises notices. Everything it computes
 * is handed to {@link CodexConfigView} as plain data.
 */
const CodexConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath ?? "";
  // Existence-checked (same as descriptor.getInstallState): a synced-but-missing
  // path reads "absent" here too, not a stale "Ready", so the dialog guides the
  // user to re-detect or clear the dead path instead of looking configured.
  const state = binaryPathInstallState(binaryPath);

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateCodexFields({ binaryPath: path });
    new Notice("Codex binary path saved.");
    return null;
  }, []);

  const onClearPath = React.useCallback((): void => {
    updateCodexFields({ binaryPath: undefined });
    new Notice("Codex binary path cleared.");
  }, []);

  return (
    <CodexConfigView
      state={state}
      binaryPath={binaryPath}
      onSavePath={onSavePath}
      onClearPath={onClearPath}
      detect={detectCodexAcpPath}
      searchedDirs={codexAcpDetectionSearchDirs}
      onClose={onClose}
    />
  );
};

/** Configure dialog for the Codex backend. Opened via `descriptor.openInstallUI`. */
export class CodexInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, "Configure Codex");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CodexConfigContainer onClose={close} />;
  }
}
