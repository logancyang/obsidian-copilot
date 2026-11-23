import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { CopilotPlusWelcomeModal } from "@/components/modals/CopilotPlusWelcomeModal";
import { useApp } from "@/context";
import type { CopilotAccount } from "@/copilotAccount/copilotAccount";
import { useAccountControl } from "@/copilotAccount/ui/useAccountControl";
import { checkIsPaidUser, navigateToPlusPage, removeLicense, useLicenseState } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import {
  CopilotLicenseSection,
  type LicenseUsageWindow,
} from "@/settings/v2/components/ui/CopilotLicenseSection";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import React, { useEffect, useState } from "react";

export interface PlusSettingsProps {
  readLicenseUsage: () => Promise<readonly LicenseUsageWindow[] | null>;
  copilotAccount: CopilotAccount | undefined;
}

function useLicenseUsage(
  isLicenseActive: boolean,
  readLicenseUsage: PlusSettingsProps["readLicenseUsage"]
): readonly LicenseUsageWindow[] | null {
  const [usageWindows, setUsageWindows] = useState<readonly LicenseUsageWindow[] | null>(null);

  useEffect(() => {
    if (!isLicenseActive) return;
    let cancelled = false;
    void readLicenseUsage().then((windows) => {
      if (!cancelled) setUsageWindows(windows);
    });
    return () => {
      cancelled = true;
      setUsageWindows(null);
    };
  }, [isLicenseActive, readLicenseUsage]);

  return usageWindows;
}

export function PlusSettings({ readLicenseUsage, copilotAccount }: PlusSettingsProps) {
  const app = useApp();
  const settings = useSettingsValue();
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const license = useLicenseState();
  const [localLicenseKey, setLocalLicenseKey] = useState(settings.plusLicenseKey);
  const usageWindows = useLicenseUsage(
    !isChecking && license.status === "active",
    readLicenseUsage
  );
  const account = useAccountControl(copilotAccount);

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
      account={account}
    />
  );
}
