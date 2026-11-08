import {
  ApiKeyStorageSection,
  type ApiKeyStorageStatus,
} from "@/settings/v2/components/ApiKeyStorageSection";
import { DebuggingSupportSection } from "@/settings/v2/components/DebuggingSupportSection";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { getCopilotSaveData } from "@/settings/copilotSaveData";
import { KeychainService } from "@/services/keychainService";
import {
  refreshLastPersistedSettings,
  releaseLegacyCredentialHold,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { hasPersistedSecrets } from "@/services/settingsSecretTransforms";
import { logError } from "@/logger";
import {
  type CopilotSettings,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const DESKTOP_UNAVAILABLE_FRAME_LOG_PATH = "(the agent activity log is desktop-only)";

export const AdvancedSettings: React.FC = () => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const [forgetting, setForgetting] = useState(false);
  const [frameLogPath, setFrameLogPath] = useState(DESKTOP_UNAVAILABLE_FRAME_LOG_PATH);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let cancelled = false;
    void import("@/agentMode").then(({ acpFrameSink }) => {
      if (!cancelled) {
        setFrameLogPath(acpFrameSink.getPath());
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const keychain = KeychainService.getInstance();
  // Provider keys live only in the Keychain behind a pointer; checking settings alone reported a working key as missing.
  // https://github.com/logancyang/obsidian-copilot/issues/3000
  const keychainStatus: ApiKeyStorageStatus = !keychain.isAvailable()
    ? "unavailable"
    : hasPersistedSecrets(settings) || keychain.hasStoredProviderKey(settings.providers)
      ? "stored"
      : "empty";

  const handleReportIssue = useCallback(() => {
    if (!isDesktopRuntime()) {
      new Notice("Reporting an issue is available on desktop only.");
      return;
    }
    void (async () => {
      const { openReportIssueModal } = await import("@/agentMode");
      openReportIssueModal(plugin, {
        activeBackend:
          plugin.agentSessionManager?.getActiveSession()?.backendId ??
          settings.agentMode.activeBackend,
      });
    })();
  }, [plugin, settings.agentMode.activeBackend]);

  const handleOpenFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice("The agent activity log is available on desktop only.");
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.open();
      setFrameLogPath(acpFrameSink.getPath());
    } catch {
      new Notice("Failed to open the agent activity log.");
    }
  }, []);

  const handleClearFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice("The agent activity log is available on desktop only.");
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.clear();
      setFrameLogPath(acpFrameSink.getPath());
      new Notice("Agent activity log cleared.");
    } catch {
      new Notice("Failed to clear the agent activity log.");
    }
  }, []);

  const handleForgetAllSecrets = useCallback(async () => {
    if (forgetting) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        "This will remove all API keys for this vault from the Obsidian Keychain, data.json, " +
          "and memory. You will need to re-enter them. Any credential backup files written " +
          "during the v4 upgrade are left in place — delete those yourself once you no longer " +
          "need them.",
        "\u26A0\uFE0F Forget All Secrets",
        "Remove",
        "Cancel",
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setForgetting(true);
    try {
      const keychain = KeychainService.getInstance();
      const saveData = getCopilotSaveData(app);

      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(
          async (data) => {
            await saveData(data);
            releaseLegacyCredentialHold();
          },
          (nextSettings) => {
            refreshLastPersistedSettings(nextSettings as CopilotSettings);
            suppressNextPersistOnce();
            setSettings(nextSettings);
          }
        )
      );
    } catch (error) {
      logError("Failed to forget secrets.", error);
      new Notice("Failed to remove API keys. Please try again.");
    } finally {
      setForgetting(false);
    }
  }, [app, forgetting]);

  return (
    <div className="tw-space-y-4">
      <LegacyChatPromptsNotice />

      <ApiKeyStorageSection
        status={keychainStatus}
        forgetting={forgetting}
        onForgetAll={safeAsyncHandler(handleForgetAllSecrets)}
      />

      <DebuggingSupportSection
        debug={settings.debug}
        onDebugChange={(checked) => updateSetting("debug", checked)}
        frameLogEnabled={settings.agentMode.debugFullFrames}
        onFrameLogChange={(checked) => {
          setSettings((cur) => ({
            agentMode: { ...cur.agentMode, debugFullFrames: checked },
          }));
        }}
        frameLogPath={frameLogPath}
        onReportIssue={handleReportIssue}
        offerFeedbackCards={settings.agentMode.offerFeedbackCards}
        onOfferFeedbackCardsChange={(checked) => {
          setSettings((cur) => ({
            agentMode: { ...cur.agentMode, offerFeedbackCards: checked },
          }));
        }}
        onOpenFrameLog={safeAsyncHandler(handleOpenFrameLog)}
        onClearFrameLog={safeAsyncHandler(handleClearFrameLog)}
      />
    </div>
  );
};
