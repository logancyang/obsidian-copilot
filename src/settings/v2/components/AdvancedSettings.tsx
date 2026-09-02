import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import {
  confirmLegacyVaultIndexToggle,
  LegacyVaultIndexSetting,
} from "@/settings/v2/components/LegacyVaultIndexSetting";
import { useApp } from "@/context";
import { logFileManager } from "@/logFileManager";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
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
import { t } from "@/i18n";

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
    // Gate before importing the agentMode barrel: on mobile the barrel pulls in
    // Node-only modules that throw during evaluation, so the desktop check must
    // happen first (mirrors the frame-log buttons below).
    if (!isDesktopRuntime()) {
      new Notice(t("settings.advanced.notice.reportDesktopOnly"));
      return;
    }
    void (async () => {
      const { ReportIssueModal } = await import("@/agentMode");
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
      // Prefer the active session's backend: switching Agent Mode tabs changes
      // the active session without touching the persisted default backend, so
      // settings.agentMode.activeBackend can name the wrong pane.
      const activeBackend =
        copilotPlugin?.agentSessionManager?.getActiveSession?.()?.backendId ??
        settings.agentMode.activeBackend;
      new ReportIssueModal({
        app,
        activeBackend,
        pluginVersion: copilotPlugin?.manifest?.version ?? "unknown",
        // Resolve at capture time so we can close this Settings window and
        // reveal the agent pane first — the screenshot should be the chat
        // surface, not the settings dialog. Null when no agent pane is open.
        resolveCaptureTarget: () => {
          (app as unknown as { setting: { close: () => void } }).setting.close();
          const leaf = app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE)[0];
          if (!leaf) return null;
          app.workspace.revealLeaf(leaf);
          const view = leaf.view as unknown as {
            contentEl?: HTMLElement;
            containerEl?: HTMLElement;
          };
          return view.contentEl ?? view.containerEl ?? null;
        },
      }).open();
    })();
  }, [app, settings.agentMode.activeBackend]);

  const handleForgetAllSecrets = useCallback(async () => {
    if (forgetting) return;

    // Reason: double-confirm destructive action via project ConfirmModal
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        t("settings.advanced.secrets.confirm"),
        t("settings.advanced.secrets.confirmTitle"),
        t("settings.actions.remove"),
        t("settings.actions.cancel"),
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setForgetting(true);
    try {
      const keychain = KeychainService.getInstance();
      const saveData = getCopilotSaveData(app);

      // Reason: run inside the persistence queue to prevent interleaving
      // with normal saves that could restore old secrets.
      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(
          // Reason: this write strips data.json outside the normal save path,
          // so once it resolves any pre-v4 credentials it was holding back are
          // gone and ordinary saves can resume. Tied to the write itself, not
          // to how the transaction settles, because only the write knows.
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
      new Notice(t("settings.advanced.notice.removeKeysFailed"));
    } finally {
      setForgetting(false);
    }
  }, [app, forgetting]);

  return (
    <div className="tw-space-y-4">
      <LegacyChatPromptsNotice />

      {/* Others Section */}
      <SettingSection label={t("settings.advanced.others")}>
        <SettingItem
          type="custom"
          title={t("settings.advanced.apiStorage.title")}
          description={
            !keychainAvailable ? (
              <>{t("settings.advanced.apiStorage.unavailable")}</>
            ) : keychainAppearsEmpty ? (
              <span className="tw-text-warning">{t("settings.advanced.apiStorage.empty")}</span>
            ) : (
              <>{t("settings.advanced.apiStorage.stored")}</>
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
                {t("settings.status.unavailable")}
              </div>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={safeAsyncHandler(handleForgetAllSecrets)}
              disabled={forgetting || !keychainAvailable}
              title={
                keychainAvailable ? undefined : t("settings.advanced.apiStorage.updateTooltip")
              }
              className="tw-gap-1.5"
            >
              <Trash2 className="tw-size-4" />
              {forgetting
                ? t("settings.advanced.apiStorage.removing")
                : t("settings.advanced.apiStorage.deleteAll")}
            </Button>
          </div>
        </SettingItem>

        {/* The switch this restores (https://github.com/logancyang/obsidian-copilot-preview/issues/319)
            is refused while Miyo owns the setting, because clearing it under a connected Miyo leaves
            retrieval pointed at an index backend that can no longer refresh.

            That refusal keys off the persisted `enableMiyo` intent rather than `shouldUseMiyo`,
            which folds in `Platform.isMobile`. Miyo needs an explicit server URL on mobile, so a
            phone syncing a desktop-configured vault would read "not Miyo", offer the switch, and
            Sync the cleared flag back to that desktop. */}
        <LegacyVaultIndexSetting
          enabled={settings.enableSemanticSearchV3}
          miyoManaged={settings.enableMiyo}
          onToggle={(next) => confirmLegacyVaultIndexToggle(app, next)}
        />

        <SettingItem
          type="switch"
          title={t("settings.advanced.debug.title")}
          description={t("settings.advanced.debug.description")}
          checked={settings.debug}
          onCheckedChange={(checked) => updateSetting("debug", checked)}
        />

        <SettingItem
          type="custom"
          title={t("settings.advanced.chatLog.title")}
          description={t("settings.advanced.chatLog.description", {
            path: logFileManager.getLogPath(),
          })}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void (async () => {
                await flushRecordedPromptPayloadToLog();
                await logFileManager.flush();
                await logFileManager.openLogFile();
              })();
            }}
          >
            {t("settings.advanced.chatLog.action")}
          </Button>
        </SettingItem>
      </SettingSection>

      {/* Agent Mode debugging Section */}
      <SettingSection
        label={t("settings.advanced.agentDebug.section")}
        description={t("settings.advanced.agentDebug.description")}
      >
        <SettingItem
          type="custom"
          title={t("settings.advanced.report.title")}
          description={t("settings.advanced.report.description")}
        >
          <Button variant="secondary" size="sm" onClick={handleReportIssue}>
            {t("settings.advanced.report.title")}
          </Button>
        </SettingItem>

        <SettingItem
          type="switch"
          title={t("settings.advanced.agentLog.title")}
          description={t("settings.advanced.agentLog.description")}
          checked={settings.agentMode.debugFullFrames}
          onCheckedChange={(checked) => {
            setSettings((cur) => ({
              agentMode: { ...cur.agentMode, debugFullFrames: checked },
            }));
          }}
        />

        <SettingItem
          type="custom"
          title={t("settings.advanced.agentLog.fileTitle")}
          description={t("settings.advanced.agentLog.fileDescription", { path: frameLogPath })}
        >
          <div className="tw-flex tw-gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={safeAsyncHandler(async () => {
                if (!isDesktopRuntime()) {
                  new Notice(t("settings.advanced.notice.agentLogDesktopOnly"));
                  return;
                }
                try {
                  const { acpFrameSink } = await import("@/agentMode");
                  await acpFrameSink.open();
                  setFrameLogPath(acpFrameSink.getPath());
                } catch {
                  new Notice(t("settings.advanced.notice.openAgentLogFailed"));
                }
              })}
            >
              {t("settings.actions.open")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={safeAsyncHandler(async () => {
                if (!isDesktopRuntime()) {
                  new Notice(t("settings.advanced.notice.agentLogDesktopOnly"));
                  return;
                }
                try {
                  const { acpFrameSink } = await import("@/agentMode");
                  await acpFrameSink.clear();
                  setFrameLogPath(acpFrameSink.getPath());
                  new Notice(t("settings.advanced.notice.agentLogCleared"));
                } catch {
                  new Notice(t("settings.advanced.notice.clearAgentLogFailed"));
                }
              })}
            >
              {t("settings.actions.clear")}
            </Button>
          </div>
        </SettingItem>
      </SettingSection>
    </div>
  );
};
