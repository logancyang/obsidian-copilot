import { CodexConfigView } from "@/agentMode/backends/codex/ui/CodexConfigView";
import { FullBleedReactModal } from "@/components/modals/ReactModal";
import { useSettingsValue } from "@/settings/model";
import { App, Notice } from "obsidian";
import React from "react";
import {
  codexAcpDetectionSearchDirs,
  detectCodexAcpPath,
  getCodexBinaryManager,
} from "./descriptor";
import { isSupportedCodexAcpPath } from "./codexVersion";

/**
 * Stateful half of the Codex Configure dialog: the only place that reads
 * settings, validates a pasted path, and raises notices. Everything it computes
 * is handed to {@link CodexConfigView} as plain data.
 */
const CodexConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const manager = getCodexBinaryManager();
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath ?? "";
  const state = isSupportedCodexAcpPath(binaryPath)
    ? ({ kind: "ready", source: "custom" } as const)
    : ({ kind: "absent" } as const);

  // Path changes must share the installer lock and update ownership together.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
  const onSavePath = React.useCallback(
    async (path: string): Promise<string | null> => {
      try {
        await manager.setCustomBinaryPath(path);
        new Notice("Codex adapter path saved.");
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [manager]
  );

  const onClearPath = React.useCallback(async (): Promise<void> => {
    try {
      await manager.setCustomBinaryPath(null);
      new Notice("Codex adapter path cleared.");
    } catch (error) {
      new Notice(
        `Couldn't clear the custom path: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [manager]);

  return (
    <CodexConfigView
      state={state}
      binaryPath={binaryPath}
      onSavePath={onSavePath}
      onClearPath={() => void onClearPath()}
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
