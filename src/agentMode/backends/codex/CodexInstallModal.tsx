import { CodexConfigView } from "@/agentMode/backends/codex/ui/CodexConfigView";
import { FullBleedReactModal } from "@/components/modals/ReactModal";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import { codexAcpDetectionSearchDirs, detectCodexAcpPath, updateCodexFields } from "./descriptor";
import { isSupportedCodexAcpPath, resolveSupportedCodexAcpEntry } from "./codexVersion";

/**
 * Stateful half of the Codex Configure dialog: the only place that reads
 * settings, validates a pasted path, and raises notices. Everything it computes
 * is handed to {@link CodexConfigView} as plain data.
 */
const CodexConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath ?? "";
  const state = isSupportedCodexAcpPath(binaryPath)
    ? ({ kind: "ready", source: "custom" } as const)
    : ({ kind: "absent" } as const);

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    try {
      resolveSupportedCodexAcpEntry(path);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    updateCodexFields({ binaryPath: path });
    new Notice("Codex adapter path saved.");
    return null;
  }, []);

  const onClearPath = React.useCallback((): void => {
    updateCodexFields({ binaryPath: undefined });
    new Notice("Codex adapter path cleared.");
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
export class CodexInstallModal extends FullBleedReactModal {
  constructor(app: App) {
    // No native title: ConfigDialogShell draws its own heading beside the badge.
    super(app);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CodexConfigContainer onClose={close} />;
  }
}
