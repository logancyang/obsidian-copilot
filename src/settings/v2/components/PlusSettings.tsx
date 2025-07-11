import { CopilotPlusWelcomeModal } from "@/components/modals/CopilotPlusWelcomeModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { checkIsPlusUser, navigateToPlusPage, useIsPlusUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ExternalLink, Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

export function PlusSettings() {
  const settings = useSettingsValue();
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const isPlusUser = useIsPlusUser();
  const [localLicenseKey, setLocalLicenseKey] = useState(settings.plusLicenseKey);
  useEffect(() => {
    setLocalLicenseKey(settings.plusLicenseKey);
  }, [settings.plusLicenseKey]);

  return (
    <section className="tw-flex tw-flex-col tw-gap-4 tw-rounded-lg tw-bg-secondary tw-p-4">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-text-xl tw-font-bold">
        <span>Copilot Plus (beta)</span>
        {isPlusUser && (
          <Badge variant="outline" className="tw-text-success">
            Active
          </Badge>
        )}
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2 tw-text-sm tw-text-muted">
        <div>
          Copilot Plus takes your Obsidian experience to the next level with cutting-edge AI
          capabilities. This premium tier unlocks advanced features, including chat context, PDF and
          image support, web search integration, exclusive chat and embedding models, and much more.
        </div>
        <div>
          Currently in beta, Copilot Plus is evolving fast, with new features and improvements
          rolling out regularly. Join now to secure the lowest price and get early access!
        </div>
      </div>
      <div className="tw-flex tw-items-center tw-gap-2">
        <PasswordInput
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
        </Button>
        <Button variant="secondary" onClick={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.SETTINGS)}>
          Join Now <ExternalLink className="tw-size-4" />
        </Button>
      </div>
      <div className="tw-text-error">{error}</div>
    </section>
  );
}
