import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ConfigDialogShell";
import { InstallCommandRow } from "@/agentMode/backends/shared/InstallCommandRow";
import { InstallStatusLine } from "@/agentMode/backends/shared/installStatus";
import type { InstallState } from "@/agentMode/session/types";
import { ReactModal } from "@/components/modals/ReactModal";
import { setSettings, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import {
  CLAUDE_INSTALL_COMMAND,
  claudeCliDetectionSearchDirs,
  detectClaudeCliPath,
  resolveClaudeCliPath,
} from "./descriptor";

/**
 * Configure dialog for the Claude (Agent SDK) backend. The SDK auto-detects the
 * `claude` CLI; this dialog surfaces the resolved path, the install command, an
 * optional custom path override, and auth guidance. There is no managed
 * install — the user installs the `claude` CLI themselves.
 */
const ClaudeConfigBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();

  const overridePath = settings.agentMode?.claudeCli?.path ?? "";
  const resolvedPath = resolveClaudeCliPath(settings);
  const isCustom = Boolean(overridePath);

  const sessionState: InstallState = resolvedPath
    ? { kind: "ready", source: isCustom ? "custom" : "managed" }
    : { kind: "absent" };

  const onSaveCustomPath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, claudeCli: { path } } }));
    new Notice("Claude CLI path saved.");
    return null;
  }, []);

  const clearCustomPath = React.useCallback((): void => {
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, claudeCli: undefined } }));
    new Notice("Claude CLI override cleared. Auto-detection will be used.");
  }, []);

  return (
    <ConfigDialogShell status={<InstallStatusLine state={sessionState} />} onClose={onClose}>
      <ConfigSection title="Install Claude Code">
        <InstallCommandRow command={CLAUDE_INSTALL_COMMAND} />
      </ConfigSection>

      <ConfigSection title="Use your own binary">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Use an existing <code>claude</code> binary you have on disk.
        </p>
        <BinaryPathSetting
          binaryName="claude"
          placeholder={
            process.platform === "win32"
              ? "/absolute/path/to/claude.exe"
              : "/absolute/path/to/claude"
          }
          initialPath={overridePath}
          notFoundHint="claude not found in known install locations. Run the install command above, then click Auto-detect again."
          onSave={onSaveCustomPath}
          onClear={clearCustomPath}
          persistOnAutoDetect
          detect={() => Promise.resolve(detectClaudeCliPath())}
          searchedDirs={claudeCliDetectionSearchDirs}
        />
      </ConfigSection>

      <ConfigSection title="Authentication">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Claude inherits auth from your local <code>claude auth login --claudeai</code>{" "}
          credentials.
        </p>
      </ConfigSection>
    </ConfigDialogShell>
  );
};

/** Configure dialog for the Claude backend. Opened via `descriptor.openInstallUI`. */
export class ClaudeInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, "Configure Claude");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <ClaudeConfigBody onClose={close} />;
  }
}
