import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import {
  confirmLegacyVaultIndexToggle,
  LegacyVaultIndexSetting,
} from "@/settings/v2/components/LegacyVaultIndexSetting";
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
import { getReportInstallId } from "@/utils/reportInstallId";
import { createReportUploader } from "@/utils/reportUpload.brevilabs";

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
      // One version for the environment block and the uploader alike. The
      // "unknown" sentinel is fine to *display* in report.md, and deliberately
      // handled at the other end of the wire: the adapter refuses to upload
      // under it, so it can never reach the endpoint (which rejects it).
      const pluginVersion = copilotPlugin?.manifest?.version ?? "unknown";
      new ReportIssueModal({
        app,
        activeBackend,
        pluginVersion,
        // Side-effect free, because this runs while the form is still up: it
        // only reports whether there is a pane to photograph, so the modal can
        // grey the option out instead of promising a shot it cannot take.
        canCaptureTarget: () => app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE).length > 0,
        // Resolve at capture time so the agent pane is revealed first — the
        // screenshot should be the chat surface. Null when no agent pane is
        // open. Whether Settings also has to go is the modal's call, not this
        // one's: it depends on which window each of them ended up in.
        resolveCaptureTarget: () => {
          const leaf = app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE)[0];
          if (!leaf) return null;
          app.workspace.revealLeaf(leaf);
          const view = leaf.view as unknown as {
            contentEl?: HTMLElement;
            containerEl?: HTMLElement;
          };
          return view.contentEl ?? view.containerEl ?? null;
        },
        dismissSettings: () => {
          (app as unknown as { setting: { close: () => void } }).setting.close();
        },
        // `installId` is a getter, resolved on the upload click rather than
        // here: its failure mode (unusable localStorage) should surface on the
        // action that needs it, as a refusal to upload — not break the modal.
        uploader: createReportUploader({
          installId: getReportInstallId,
          clientVersion: pluginVersion,
        }),
      }).open();
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
      </SettingSection>

      {/* Debugging & support Section */}
      <SettingSection label="Debugging & support">
        <SettingItem
          type="custom"
          title="Report an issue"
          description="Walks you through collecting a screenshot and recent logs, packs them into a single zip you can review, uploads it privately, and opens a prefilled GitHub issue with the report ID already in it."
        >
          <Button variant="default" size="sm" onClick={handleReportIssue}>
            Report an issue
          </Button>
        </SettingItem>

        <SettingItem
          type="switch"
          title="Debug Mode"
          description="Logs Copilot chat activity to the developer console (View → Toggle Developer Tools), and pre-selects the chat log when you report an issue."
          checked={settings.debug}
          onCheckedChange={(checked) => updateSetting("debug", checked)}
        />

        <SettingItem
          type="custom"
          title="Agent Mode activity log"
          description={`Records the behind-the-scenes messages between Copilot and the agent so a report always has recent activity to attach. Stored on this device only, outside your vault (${frameLogPath}), and can include your prompts and note contents in plain text.`}
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <SettingSwitch
              checked={settings.agentMode.debugFullFrames}
              onCheckedChange={(checked) => {
                setSettings((cur) => ({
                  agentMode: { ...cur.agentMode, debugFullFrames: checked },
                }));
              }}
            />
            <Button variant="secondary" size="sm" onClick={safeAsyncHandler(handleOpenFrameLog)}>
              Open
            </Button>
            <Button variant="secondary" size="sm" onClick={safeAsyncHandler(handleClearFrameLog)}>
              Clear
            </Button>
          </div>
        </SettingItem>
      </SettingSection>
    </div>
  );
};
