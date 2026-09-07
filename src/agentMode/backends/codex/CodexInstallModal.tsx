import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import type { CodexBinaryManager } from "@/agentMode/backends/codex/CodexBinaryManager";
import { CODEX_BUNDLE_VERSION } from "@/agentMode/backends/codex/cliSetup";
import {
  CodexConfigView,
  type CodexBinarySource,
} from "@/agentMode/backends/codex/ui/CodexConfigView";
import { ManagedInstallOperationInFlightError } from "@/agentMode/backends/shared/managedInstall";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { FullBleedReactModal } from "@/components/modals/ReactModal";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { formatBinaryPathForDisplay } from "@/utils/binaryPath";
import { formatBytes } from "@/utils/formatBytes";
import { App, Notice } from "obsidian";
import React from "react";
import {
  CodexBackendDescriptor,
  codexAcpDetectionSearchDirs,
  detectCodexAcpPath,
  getCodexBinaryManager,
} from "./descriptor";

interface CodexConfigContainerProps {
  manager: CodexBinaryManager;
  onClose: () => void;
}

/** Connects the shared configuration view to Codex's settings and binary manager. */
export const CodexConfigContainer: React.FC<CodexConfigContainerProps> = ({ manager, onClose }) => {
  const app = useApp();
  const settings = useSettingsValue();
  const codex = settings.agentMode?.backends?.codex;
  const binaryPath = codex?.binaryPath ?? "";
  const state = CodexBackendDescriptor.getInstallState(settings);
  const auth = useBackendAuthState(
    CodexBackendDescriptor,
    `${binaryPath}:${JSON.stringify(codex?.envOverrides)}`
  );
  const configuredSource = binaryPath ? (codex?.binarySource ?? "custom") : null;
  // A missing managed adapter needs a first install, just as it does in OpenCode.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
  const activeSource =
    state.kind === "ready" || state.kind === "incompatible" ? state.source : null;
  // Browsing setup choices must never replace the configured adapter. Reopened installs need progress and Cancel.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
  const [source, setSource] = React.useState<CodexBinarySource>(() =>
    manager.getRuntimeState().kind === "installing" ? "managed" : (configuredSource ?? "managed")
  );
  const runtime = React.useSyncExternalStore(
    manager.subscribeRuntimeState,
    manager.getRuntimeState,
    manager.getRuntimeState
  );
  const run = manager.getActionState();

  const install = (): void => {
    manager.install().catch((error: unknown) => {
      // Cancellation belongs to the user; a competing action cannot overwrite shared progress.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      if ((error as Error)?.name === "AbortError") return;
      if (error instanceof ManagedInstallOperationInFlightError) new Notice(error.message);
      logError("[AgentMode] Codex install failed", error);
    });
  };

  const saveCustomPath = async (path: string): Promise<string | null> => {
    try {
      await manager.setCustomBinaryPath(path);
      new Notice("Codex adapter path saved.");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const clearCustomPath = async (): Promise<void> => {
    try {
      await manager.setCustomBinaryPath(null);
      new Notice("Codex adapter path cleared.");
    } catch (error) {
      new Notice(
        `Couldn't clear the custom path: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const uninstall = async (): Promise<void> => {
    try {
      const size = formatBytes(await manager.downloadsSize());
      new ConfirmModal(
        app,
        async () => {
          try {
            await manager.uninstall();
            new Notice(`Codex adapter uninstalled (freed ${size}).`);
          } catch (error) {
            // Removal can fail while files are in use; report failure without claiming they were removed.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
            new Notice(
              `Couldn't uninstall the Codex adapter: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        },
        `Remove all Copilot-managed Codex adapter downloads (${size})? Your own binary and Codex login are kept.`,
        "Uninstall Codex adapter",
        "Uninstall"
      ).open();
    } catch (error) {
      // If download inspection fails, do not confirm removal with an unknown size.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      new Notice(
        `Couldn't inspect Codex downloads: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  return (
    <CodexConfigView
      state={state}
      auth={{ ...auth, onSignIn: auth.signIn, onCancel: auth.cancelSignIn }}
      // Keep progress and Cancel visible when a managed install starts in another window.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
      source={runtime.kind === "installing" ? "managed" : source}
      onSourceChange={setSource}
      activeSource={activeSource}
      managed={{
        platform: `${process.platform}-${process.arch}`,
        version: CODEX_BUNDLE_VERSION,
        destination: formatBinaryPathForDisplay(manager.getDataDir()),
        run,
      }}
      customPath={configuredSource === "custom" ? binaryPath : ""}
      upgradeRun={run}
      actions={{
        install,
        cancelInstall: () => manager.cancelCurrentOperation(),
        uninstall: () => void uninstall(),
        upgrade: install,
        saveCustomPath,
        clearCustomPath,
        detectCustomPath: detectCodexAcpPath,
      }}
      searchedDirs={codexAcpDetectionSearchDirs}
      onClose={onClose}
    />
  );
};

/** Hosts Codex configuration in Obsidian's native modal; the manager owns operations across closes. */
export class CodexInstallModal extends FullBleedReactModal {
  constructor(app: App) {
    super(app);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CodexConfigContainer manager={getCodexBinaryManager()} onClose={close} />;
  }
}
