import { cursorSignInCommand } from "@/agentMode/backends/cursor/cliSetup";
import { CursorConfigView } from "@/agentMode/backends/cursor/ui/CursorConfigView";
import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import { FullBleedReactModal } from "@/components/modals/ReactModal";
import { setSettings, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import {
  CursorBackendDescriptor,
  cursorCliDetectionSearchDirs,
  detectCursorCliPath,
} from "./descriptor";

const CursorConfigContainer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();
  const cursor = settings.agentMode?.backends?.cursor;
  const binaryPathOverride = cursor?.binaryPath;
  const binaryPath =
    CursorBackendDescriptor.getResolvedBinaryPath?.(settings) ?? binaryPathOverride ?? "";
  const state = CursorBackendDescriptor.getInstallState(settings);
  const auth = useBackendAuthState(CursorBackendDescriptor, binaryPath);

  const onSavePath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    setSettings((current) => ({
      agentMode: {
        ...current.agentMode,
        backends: {
          ...current.agentMode.backends,
          cursor: {
            ...current.agentMode.backends?.cursor,
            binaryPath: path,
            binarySource: "custom",
          },
        },
      },
    }));
    new Notice("Cursor installation path saved.");
    return null;
  }, []);

  const onClearPath = React.useCallback((): void => {
    setSettings((current) => {
      const cursorSettings = { ...(current.agentMode.backends?.cursor ?? {}) };
      delete cursorSettings.binaryPath;
      delete cursorSettings.binarySource;
      return {
        agentMode: {
          ...current.agentMode,
          backends: { ...current.agentMode.backends, cursor: cursorSettings },
        },
      };
    });
    new Notice("Cursor installation override cleared. Auto-detection will be used.");
  }, []);

  return (
    <CursorConfigView
      state={state}
      binaryPath={binaryPath}
      hasBinaryPathOverride={Boolean(binaryPathOverride)}
      onSavePath={onSavePath}
      onClearPath={onClearPath}
      detect={() => Promise.resolve(detectCursorCliPath())}
      searchedDirs={cursorCliDetectionSearchDirs}
      auth={{
        status: auth.status,
        onSignIn: auth.signIn,
        signingIn: auth.signingIn,
        url: auth.url,
        onCancel: auth.cancelSignIn,
        failed: auth.failed,
        signingOut: auth.signingOut,
        onSignOut: auth.signOut,
        terminalCommand: cursorSignInCommand(
          binaryPath ? (binaryPathOverride ?? "agent") : undefined,
          cursor?.envOverrides,
          process.platform
        ),
      }}
      onClose={onClose}
    />
  );
};

export class CursorInstallModal extends FullBleedReactModal {
  constructor(app: App) {
    super(app);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CursorConfigContainer onClose={close} />;
  }
}
