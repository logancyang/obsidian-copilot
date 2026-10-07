import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { DebuggingSupportSection } from "@/settings/v2/components/DebuggingSupportSection";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import { useApp } from "@/context";
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
import { Info, ShieldCheck, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const DESKTOP_UNAVAILABLE_FRAME_LOG_PATH = "(Agent Mode frame logs are desktop-only)";

export const AdvancedSettings: React.FC = () => {
  const app = useApp();
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

  const keychainAvailable = KeychainService.getInstance().isAvailable();
  const keychainAppearsEmpty = keychainAvailable && !hasPersistedSecrets(settings);

  const handleReportIssue = useCallback(() => {
    if (!isDesktopRuntime()) {
      new Notice("Reporting an issue is available on desktop only.");
      return;
    }
    void (async () => {
      const { openReportIssueModal } = await import("@/agentMode");
      const copilotPlugin = (
        app as unknown as {
          plugins: {
            getPlugin: (id: string) => {
              manifest?: { version?: string };
              agentSessionManager?: { getActiveSession?: () => { backendId?: string } | null };
            } | null;
          };
        }
      ).plugins.getPlugin("copilot");
      const activeBackend =
        copilotPlugin?.agentSessionManager?.getActiveSession?.()?.backendId ??
        settings.agentMode.activeBackend;
      const pluginVersion = copilotPlugin?.manifest?.version ?? "unknown";
      openReportIssueModal({
        app,
        activeBackend,
        pluginVersion,
        dismissSettings: () => {
          (app as unknown as { setting: { close: () => void } }).setting.close();
        },
      });
    })();
  }, [app, settings.agentMode.activeBackend]);

  const handleOpenFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice("Agent Mode frame logs are available on desktop only.");
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.open();
      setFrameLogPath(acpFrameSink.getPath());
    } catch {
      new Notice("Failed to open Agent Mode frame log.");
    }
  }, []);

  const handleClearFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice("Agent Mode frame logs are available on desktop only.");
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.clear();
      setFrameLogPath(acpFrameSink.getPath());
      new Notice("Agent Mode frame log cleared.");
    } catch {
      new Notice("Failed to clear Agent Mode frame log.");
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

      <SettingSection label="Others">
        <SettingItem
          type="custom"
          title="API Key Storage"
          description={
            !keychainAvailable ? (
              <>
                Update Obsidian to <code>1.11.4+</code> to use the{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>. Keys
                cannot be loaded or saved in this build.
              </>
            ) : keychainAppearsEmpty ? (
              <span className="tw-text-warning">
                No API keys found in this device&apos;s{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
                Re-enter your API keys in the relevant settings sections — each device has a
                separate Keychain.
              </span>
            ) : (
              <>
                API keys are stored in this device&apos;s{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
              </>
            )
          }
        >
          <div className="tw-flex tw-flex-col tw-items-start tw-gap-2 sm:tw-items-end">
            {keychainAvailable ? (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-bg-success tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-success">
                <ShieldCheck className="tw-size-4" />
                Obsidian Keychain
              </div>
            ) : (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-muted">
                <Info className="tw-size-4" />
                Unavailable
              </div>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={safeAsyncHandler(handleForgetAllSecrets)}
              disabled={forgetting || !keychainAvailable}
              title={
                keychainAvailable
                  ? undefined
                  : "Update Obsidian to 1.11.4+ to delete Keychain entries."
              }
              className="tw-gap-1.5"
            >
              <Trash2 className="tw-size-4" />
              {forgetting ? "Removing..." : "Delete All Keys"}
            </Button>
          </div>
        </SettingItem>
      </SettingSection>

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
        onOpenFrameLog={safeAsyncHandler(handleOpenFrameLog)}
        onClearFrameLog={safeAsyncHandler(handleClearFrameLog)}
      />
    </div>
  );
};
