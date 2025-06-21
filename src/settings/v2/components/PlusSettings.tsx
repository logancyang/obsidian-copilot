// import { CopilotPlusWelcomeModal } from "@/components/modals/CopilotPlusWelcomeModal"; // Plus features disabled
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input"; // Keep for potential future use if settings structure changes
import { PLUS_UTM_MEDIUMS } from "@/constants";
// import { checkIsPlusUser, navigateToPlusPage, useIsPlusUser } from "@/plusUtils"; // Plus features disabled
import { navigateToPlusPage } from "@/plusUtils"; // Only navigateToPlusPage is needed
// import { updateSetting, useSettingsValue } from "@/settings/model"; // Plus features disabled
import { ExternalLink, Loader2 } from "lucide-react"; // Loader2 might not be needed
import React, { useEffect, useState } from "react"; // useState, useEffect might not be needed

export function PlusSettings() {
  // const settings = useSettingsValue(); // Plus features disabled
  // const [error, setError] = useState<string | null>(null); // Plus features disabled
  // const [isChecking, setIsChecking] = useState(false); // Plus features disabled
  // const isPlusUser = useIsPlusUser(); // Plus features disabled
  // const [localLicenseKey, setLocalLicenseKey] = useState(settings.plusLicenseKey); // Plus features disabled
  // useEffect(() => { // Plus features disabled
  //   setLocalLicenseKey(settings.plusLicenseKey); // Plus features disabled
  // }, [settings.plusLicenseKey]); // Plus features disabled

  console.warn("PlusSettings UI component disabled due to Phase 1 decoupling. License key input and related UI are removed.");

  return (
    <section className="tw-flex tw-flex-col tw-gap-4 tw-rounded-lg tw-bg-secondary tw-p-4">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-text-xl tw-font-bold">
        <span>Copilot Plus</span>
        {/* {isPlusUser && ( // Plus features disabled
          <Badge variant="outline" className="tw-text-success">
            Active
          </Badge>
        )} */}
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2 tw-text-sm tw-text-muted">
        <div>
          Copilot Plus features requiring a license key are currently disabled.
        </div>
        <div>
          For more information about Copilot Plus, please visit our website.
        </div>
      </div>
      <div className="tw-flex tw-items-center tw-gap-2">
        {/* <PasswordInput
          className="tw-w-full"
          placeholder="Enter your license key"
          value={localLicenseKey}
          onChange={(value) => {
            setLocalLicenseKey(value);
          }}
        />
        <Button
          disabled={isChecking}
          onClick={async () => {
            updateSetting("plusLicenseKey", localLicenseKey);
            setIsChecking(true);
            const result = await checkIsPlusUser();
            setIsChecking(false);
            if (!result) {
              setError("Invalid license key");
            } else {
              setError(null);
              new CopilotPlusWelcomeModal(app).open();
            }
          }}
          className="tw-min-w-20"
        >
          {isChecking ? <Loader2 className="tw-size-4 tw-animate-spin" /> : "Apply"}
        </Button> */}
        <Button variant="secondary" onClick={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.SETTINGS)}>
          Learn More <ExternalLink className="tw-size-4" />
        </Button>
      </div>
      {/* <div className="tw-text-error">{error}</div> */}
    </section>
  );
}
