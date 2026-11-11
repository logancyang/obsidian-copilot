import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { updateAgentModeBackendFields, useSettingsValue } from "@/settings/model";
import React from "react";

export const AntigravitySettingsPanel: React.FC = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="Antigravity"
      value={settings.agentMode?.backends?.antigravity?.envOverrides}
      onChange={(next) => updateAgentModeBackendFields("antigravity", { envOverrides: next })}
      hintExamples={["HOME", "HTTPS_PROXY"]}
    />
  );
};
