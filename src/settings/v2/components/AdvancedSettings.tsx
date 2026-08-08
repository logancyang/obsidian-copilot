import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
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
      new Notice("Reporting an issue is available on desktop only.");
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
      new Notice("Failed to remove API keys. Please try again.");
    } finally {
      setForgetting(false);
    }
  }, [app, forgetting]);

  return (
    <div className="tw-space-y-4">
      <LegacyChatPromptsNotice />

      {/* Others Section */}
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
              onClick={handleForgetAllSecrets}
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

        <SettingItem
          type="switch"
          title="Debug Mode"
          description="Logs Copilot chat activity to the developer console (View → Toggle Developer Tools). For troubleshooting the regular chat — Agent Mode has its own log below."
          checked={settings.debug}
          onCheckedChange={(checked) => updateSetting("debug", checked)}
        />

        <SettingItem
          type="custom"
          title="Create Log File"
          description={`Save and open the regular Copilot chat log (${logFileManager.getLogPath()}) to share when reporting a chat issue. Agent Mode issues are handled by the "Report an Issue" button in the agent pane instead.`}
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
            Create Log File
          </Button>
        </SettingItem>
      </SettingSection>

      {/* Agent Mode debugging Section */}
      <SettingSection
        label="Agent Mode debugging"
        description="Tools for diagnosing Agent Mode problems, separate from the regular Copilot chat logs above."
      >
        <SettingItem
          type="custom"
          title="Report an Issue"
          description="Bundles a screenshot of the Agent Mode chat pane and a recent activity log into a folder, then opens a prefilled GitHub issue for you to attach them to."
        >
          <Button variant="secondary" size="sm" onClick={handleReportIssue}>
            Report an Issue
          </Button>
        </SettingItem>

        <SettingItem
          type="switch"
          title="Keep an Agent Mode activity log"
          description="Records the behind-the-scenes messages between Copilot and the agent so the Report an Issue button always has recent activity to attach. Stored on this device only, outside your vault, and can include your prompts and note contents in plain text. On by default; turn off to stop logging."
          checked={settings.agentMode.debugFullFrames}
          onCheckedChange={(checked) => {
            setSettings((cur) => ({
              agentMode: { ...cur.agentMode, debugFullFrames: checked },
            }));
          }}
        />

        <SettingItem
          type="custom"
          title="Agent Mode activity log file"
          description={`Open or clear the log file on disk (${frameLogPath}).`}
        >
          <div className="tw-flex tw-gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
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
              }}
            >
              Open
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
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
              }}
            >
              Clear
            </Button>
          </div>
        </SettingItem>
      </SettingSection>
    </div>
  );
};
