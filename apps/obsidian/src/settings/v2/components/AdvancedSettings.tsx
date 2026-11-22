import { DebuggingSupportSection } from "@/settings/v2/components/DebuggingSupportSection";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import { usePlugin } from "@/contexts/PluginContext";
import { setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const DESKTOP_UNAVAILABLE_FRAME_LOG_PATH = "(the agent activity log is desktop-only)";

export const AdvancedSettings: React.FC = () => {
  const plugin = usePlugin();
  const settings = useSettingsValue();
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

  return (
    <div className="tw-space-y-4">
      <LegacyChatPromptsNotice />

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
