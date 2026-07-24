import { SettingItem } from "@/components/ui/setting-item";
import { updateAgentModeBackendFields, useSettingsValue } from "@/settings/model";
import React from "react";

/**
 * Pi card extras. Pi ships inside the plugin, so there is no binary to install
 * or account to sign into — the only control is the opt-in that makes it
 * appear in the agent picker at all.
 */
export const PiSettingsPanel: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <SettingItem
      type="switch"
      title="Enable Pi"
      description="Pi runs inside the plugin — no install, no CLI. Experimental: it appears in the agent picker only while this is on."
      checked={Boolean(settings.agentMode?.backends?.pi?.enabled)}
      onCheckedChange={(checked) => updateAgentModeBackendFields("pi", { enabled: checked })}
    />
  );
};
