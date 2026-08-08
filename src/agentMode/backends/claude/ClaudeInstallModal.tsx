import { ClaudeConfigView } from "@/agentMode/backends/claude/ui/ClaudeConfigView";
import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import { ReactModal } from "@/components/modals/ReactModal";
import { getSettings, setSettings, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import {
  claudeCliDetectionSearchDirs,
  detectClaudeCliPath,
  getClaudeInstallState,
  refreshClaudeInstallState,
  subscribeClaudeInstallState,
  type ClaudeDescriptor,
} from "./descriptor";

/**
 * Stateful half of the Claude Configure dialog: the only place that reads
 * settings, validates a pasted path, drives the CLI's sign-in, and raises
 * notices. Everything it computes is handed to {@link ClaudeConfigView} as
 * plain data.
 */
const ClaudeConfigContainer: React.FC<{
  descriptor: ClaudeDescriptor;
  onClose: () => void;
}> = ({ descriptor, onClose }) => {
  const settings = useSettingsValue();
  const getInstallStateSnapshot = React.useCallback(
    () => getClaudeInstallState(settings),
    [settings]
  );
  const state = React.useSyncExternalStore(subscribeClaudeInstallState, getInstallStateSnapshot);
  const binaryPathOverride = settings.agentMode?.claudeCli?.path;
  const binaryPath = descriptor.getResolvedBinaryPath(settings) ?? binaryPathOverride ?? "";
  const auth = useBackendAuthState(descriptor, binaryPath);

  React.useEffect(() => {
    void refreshClaudeInstallState(getSettings(), true);
  }, []);

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, claudeCli: { path } } }));
    await refreshClaudeInstallState(getSettings(), true);
    new Notice("Claude CLI path saved.");
    return null;
  }, []);

  const onClearPath = React.useCallback((): void => {
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, claudeCli: undefined } }));
    new Notice("Claude CLI override cleared. Auto-detection will be used.");
  }, []);

  return (
    <ClaudeConfigView
      state={state}
      binaryPath={binaryPath}
      hasBinaryPathOverride={Boolean(binaryPathOverride)}
      onSavePath={onSavePath}
      onClearPath={onClearPath}
      detect={() => Promise.resolve(detectClaudeCliPath())}
      searchedDirs={claudeCliDetectionSearchDirs}
      auth={{
        status: auth.status,
        onSignIn: auth.signIn,
        signingIn: auth.signingIn,
        url: auth.url,
      }}
      onClose={onClose}
    />
  );
};

/** Configure dialog for the Claude backend. Opened via `descriptor.openInstallUI`. */
export class ClaudeInstallModal extends ReactModal {
  constructor(
    app: App,
    private readonly descriptor: ClaudeDescriptor
  ) {
    super(app, "Configure Claude");
    this.modalEl.addClass("copilot-config-modal");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <ClaudeConfigContainer descriptor={this.descriptor} onClose={close} />;
  }
}
