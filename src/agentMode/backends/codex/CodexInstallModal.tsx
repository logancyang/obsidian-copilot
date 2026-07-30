import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ConfigDialogShell";
import { InstallCommandRow } from "@/agentMode/backends/shared/InstallCommandRow";
import { InstallStatusLine } from "@/agentMode/backends/shared/installStatus";
import { ReactModal } from "@/components/modals/ReactModal";
import { getSettings, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import {
  CODEX_BINARY_NAME,
  codexAcpDetectionSearchDirs,
  detectCodexAcpPath,
  getCodexInstallState,
  refreshCodexInstallState,
  subscribeCodexInstallState,
  updateCodexFields,
} from "./descriptor";
import { getCodexInstallGuidance } from "./codexCompatibility";

interface CodexConfigBodyProps {
  onClose: () => void;
  platform?: NodeJS.Platform;
}

/**
 * Configure dialog for the Codex backend. Copilot spawns the native
 * `codex-acp` ACP adapter. The dialog configures the codex-acp path
 * and gives auth guidance; `codex login` owns the user's auth state.
 */
export const CodexConfigBody: React.FC<CodexConfigBodyProps> = ({
  onClose,
  platform = process.platform,
}) => {
  const settings = useSettingsValue();
  const installGuidance = getCodexInstallGuidance(platform);
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath ?? "";
  const getInstallStateSnapshot = React.useCallback(
    () => getCodexInstallState(settings),
    [settings]
  );
  const sessionState = React.useSyncExternalStore(
    subscribeCodexInstallState,
    getInstallStateSnapshot
  );
  const needsLegacyRemoval = sessionState.kind === "error" || sessionState.kind === "absent";

  React.useEffect(() => {
    const current = getCodexInstallState(getSettings());
    void refreshCodexInstallState(getSettings(), current.kind !== "ready");
  }, []);

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateCodexFields({ binaryPath: path });
    await refreshCodexInstallState(getSettings(), true);
    new Notice("Codex binary path saved.");
    return null;
  }, []);

  const clearCodexPath = React.useCallback((): void => {
    updateCodexFields({ binaryPath: undefined });
    new Notice("Codex binary path cleared.");
  }, []);

  return (
    <ConfigDialogShell status={<InstallStatusLine state={sessionState} />} onClose={onClose}>
      <ConfigSection title="Install codex-acp">
        {needsLegacyRemoval && installGuidance.removeLegacyCommand && (
          <InstallCommandRow
            command={installGuidance.removeLegacyCommand}
            label="1. Remove the superseded adapter"
          />
        )}
        <InstallCommandRow
          command={installGuidance.installCommand}
          label={
            needsLegacyRemoval
              ? installGuidance.removeLegacyCommand
                ? "2. Install the maintained adapter"
                : "Replace with the maintained adapter (Windows PowerShell)"
              : undefined
          }
        />
      </ConfigSection>

      <ConfigSection title="Use your own binary">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Use an existing <code>{CODEX_BINARY_NAME}</code> binary you have on disk.
        </p>
        <BinaryPathSetting
          binaryName={CODEX_BINARY_NAME}
          placeholder="/absolute/path/to/codex-acp.exe"
          initialPath={binaryPath}
          notFoundHint={`${CODEX_BINARY_NAME} not found in known install locations or PATH. Run the install command above, then click Auto-detect again.`}
          detect={detectCodexAcpPath}
          searchedDirs={codexAcpDetectionSearchDirs}
          onSave={onSavePath}
          onClear={clearCodexPath}
          persistOnAutoDetect
        />
      </ConfigSection>

      <ConfigSection title="Authentication">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Codex inherits auth from your local <code>codex login</code> credentials.
        </p>
      </ConfigSection>
    </ConfigDialogShell>
  );
};

/** Configure dialog for the Codex backend. Opened via `descriptor.openInstallUI`. */
export class CodexInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, "Configure Codex");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CodexConfigBody onClose={close} />;
  }
}
