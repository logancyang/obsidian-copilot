import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ConfigDialogShell";
import { InstallCommandRow } from "@/agentMode/backends/shared/InstallCommandRow";
import { InstallStatusLine } from "@/agentMode/backends/shared/installStatus";
import type { InstallState } from "@/agentMode/session/types";
import { ReactModal } from "@/components/modals/ReactModal";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import { CODEX_BINARY_NAME, CODEX_INSTALL_COMMAND, updateCodexFields } from "./descriptor";

/**
 * Configure dialog for the Codex backend. Codex spawns the self-contained
 * `codex-acp` binary (it bundles the Codex engine as Rust crates — no separate
 * `codex` CLI is needed at runtime). The dialog configures the codex-acp path
 * and gives auth guidance; the `codex` CLI is only relevant for `codex login`.
 */
const CodexConfigBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const binaryPath = settings.agentMode?.backends?.codex?.binaryPath ?? "";
  const sessionState: InstallState = binaryPath
    ? { kind: "ready", source: "custom" }
    : { kind: "absent" };

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateCodexFields({ binaryPath: path });
    new Notice("Codex binary path saved.");
    return null;
  }, []);

  return (
    <ConfigDialogShell status={<InstallStatusLine state={sessionState} />} onClose={onClose}>
      <ConfigSection title="Install codex-acp">
        <InstallCommandRow command={CODEX_INSTALL_COMMAND} />
      </ConfigSection>

      <ConfigSection title="codex-acp path">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Use an existing <code>{CODEX_BINARY_NAME}</code> binary you have on disk.
        </p>
        <BinaryPathSetting
          binaryName={CODEX_BINARY_NAME}
          placeholder="/absolute/path/to/codex-acp"
          initialPath={binaryPath}
          notFoundHint={`${CODEX_BINARY_NAME} not found on PATH. Run the install command above, then click Auto-detect again.`}
          onSave={onSavePath}
          persistOnAutoDetect
        />
      </ConfigSection>

      <ConfigSection title="Authentication">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Codex inherits auth from your local <code>codex login</code> credentials, or from{" "}
          <code>OPENAI_API_KEY</code> / <code>CODEX_API_KEY</code> exported in your shell.
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
