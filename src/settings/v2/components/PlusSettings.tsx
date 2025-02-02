import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { checkIsPlusUser, navigateToPlusPage, useIsPlusUser } from "@/plusUtils";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ExternalLink, Loader2 } from "lucide-react";
import React, { useState } from "react";

export function PlusSettings() {
  const settings = useSettingsValue();
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const isPlusUser = useIsPlusUser();

  return (
    <section className="flex flex-col gap-4 bg-secondary p-4 rounded-lg">
      <div className="text-xl font-bold flex items-center gap-2 justify-between">
        <span>Copilot Plus (beta)</span>
        {isPlusUser && (
          <Badge variant="outline" className="text-success">
            Active
          </Badge>
        )}
      </div>
      <div className="text-sm text-muted flex flex-col gap-2">
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
      <div className="flex items-center gap-2">
        <PasswordInput
          className="w-full"
          placeholder="Enter your license key"
          value={settings.plusLicenseKey}
          onChange={(value) => {
            updateSetting("plusLicenseKey", value);
          }}
        />
        <Button
          disabled={isChecking || !settings.plusLicenseKey}
          onClick={async () => {
            setIsChecking(true);
            const result = await checkIsPlusUser();
            setIsChecking(false);
            if (!result) {
              setError("Invalid license key");
            } else {
              setError(null);
            }
          }}
          className="min-w-20"
        >
          {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
        </Button>
        <Button variant="default" onClick={() => navigateToPlusPage(PLUS_UTM_MEDIUMS.SETTINGS)}>
          Join Now <ExternalLink className="size-4" />
        </Button>
      </div>
      <div className="text-error">{error}</div>
    </section>
  );
}
