import type { UsageWindow } from "@/agentMode";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { CopilotPlusWelcomeModal } from "@/components/modals/CopilotPlusWelcomeModal";
import { useApp } from "@/context";
import { checkIsPaidUser, navigateToPlusPage, removeLicense, useLicenseState } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { CopilotLicenseSection } from "@/settings/v2/components/ui/CopilotLicenseSection";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import React, { useEffect, useState } from "react";

function useLicenseUsage(isLicenseActive: boolean): readonly UsageWindow[] | null {
  const [usageWindows, setUsageWindows] = useState<readonly UsageWindow[] | null>(null);

  useEffect(() => {
    // The usage reader ships with Agent Mode, whose code cannot load on mobile.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/923
    if (!isLicenseActive || !isDesktopRuntime()) return;
    let cancelled = false;
    void import("@/agentMode")
      .then(({ CopilotPlusUsageReader }) => new CopilotPlusUsageReader().readPlanUsage())
      .then((reading) => {
        if (!cancelled)
          setUsageWindows(reading.kind === "usage" ? reading.planUsage.windows : null);
      });
    return () => {
      cancelled = true;
      setUsageWindows(null);
    };
  }, [isLicenseActive]);

  return usageWindows;
}

export function PlusSettings() {
  const app = useApp();
  const settings = useSettingsValue();
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const license = useLicenseState();
  const [localLicenseKey, setLocalLicenseKey] = useState(settings.plusLicenseKey);
  const usageWindows = useLicenseUsage(!isChecking && license.status === "active");

  const confirmRemoveLicense = () => {
    new ConfirmModal(
      app,
      () => {
        removeLicense();
        setLocalLicenseKey("");
        setError(null);
      },
      "Paid features turn off until you apply a license key again. Your plan itself is not affected.",
      "Remove license?",
      "Remove license",
      "Cancel",
      undefined,
      "destructive"
    ).open();
  };

  return (
    <CopilotLicenseSection
      license={license}
      licenseKey={localLicenseKey}
      onLicenseKeyChange={setLocalLicenseKey}
      isApplying={isChecking}
      onApply={safeAsyncHandler(async () => {
        updateSetting("plusLicenseKey", localLicenseKey);
        setIsChecking(true);
        const result = await checkIsPaidUser(app, { trigger: "manual" });
        setIsChecking(false);
        if (!result) {
          setError("Invalid license key");
        } else {
          setError(null);
          new CopilotPlusWelcomeModal(app).open();
        }
      })}
      applyError={error}
      onSeePlans={() => navigateToPlusPage("settings")}
      usageWindows={usageWindows}
      onRemoveLicense={confirmRemoveLicense}
    />
  );
}
