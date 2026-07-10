import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ConfigDialogShell";
import { InstallCommandRow } from "@/agentMode/backends/shared/InstallCommandRow";
import { InstallStatusLine } from "@/agentMode/backends/shared/installStatus";
import { ReactModal } from "@/components/modals/ReactModal";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import { codexInstallState } from "./CodexBinaryManager";
import {
  CODEX_BINARY_NAME,
  CODEX_INSTALL_COMMAND,
  codexAcpDetectionSearchDirs,
  detectCodexAcpPath,
  getCodexBinaryManager,
  updateCodexFields,
} from "./descriptor";

/**
 * Configure dialog for the Codex backend. Copilot spawns the native
 * `codex-acp` ACP adapter. The dialog configures the codex-acp path
 * and gives auth guidance; `codex login` owns the user's auth state.
 */
export const CodexConfigBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath ?? "";
  const sessionState = codexInstallState(settings.agentMode?.backends?.codex);
  const details =
    sessionState.kind === "ready" || sessionState.kind === "blocked"
      ? sessionState.details
      : undefined;
  const versionDetail =
    details?.adapterVersion || details?.cliVersion ? (
      <>
        {details.adapterVersion && <>Adapter {details.adapterVersion}</>}
        {details.adapterVersion && details.cliVersion && " · "}
        {details.cliVersion && (
          <>
            Effective CLI {details.cliVersion}
            {details.cliSource ? ` (${details.cliSource})` : ""}
          </>
        )}
      </>
    ) : undefined;

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateCodexFields({ binaryPath: path });
    // Re-probe even when auto-detection resolves to the already-saved path:
    // replacing an unsupported package normally changes the executable in
    // place, so the path fingerprint alone cannot observe the migration.
    await getCodexBinaryManager().refreshInstallState();
    new Notice("Codex binary path saved.");
    return null;
  }, []);

  const clearCodexPath = React.useCallback((): void => {
    updateCodexFields({ binaryPath: undefined });
    new Notice("Codex binary path cleared.");
  }, []);

  return (
    <ConfigDialogShell
      status={<InstallStatusLine state={sessionState} detail={versionDetail} />}
      onClose={onClose}
    >
      {sessionState.kind === "blocked" ? (
        <ConfigSection title="Replace the unsupported adapter">
          <p className="tw-my-0 tw-text-sm tw-text-warning">{sessionState.reason}</p>
          <InstallCommandRow command={sessionState.remediation} label="Replacement command" />
        </ConfigSection>
      ) : (
        <ConfigSection title="Install codex-acp">
          <InstallCommandRow command={CODEX_INSTALL_COMMAND} />
        </ConfigSection>
      )}

      {details?.warning && (
        <div className="tw-rounded tw-bg-callout-warning/20 tw-p-2 tw-text-xs tw-text-warning">
          {details.warning}
        </div>
      )}

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
