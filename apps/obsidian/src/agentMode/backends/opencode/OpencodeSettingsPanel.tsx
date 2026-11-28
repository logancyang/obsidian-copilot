import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { updateAgentModeBackendFields, useSettingsValue } from "@/settings/model";
import React from "react";

export const OpencodeSettingsPanel: React.FC = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="OpenCode"
      value={settings.agentMode?.backends?.opencode?.envOverrides}
      onChange={(next) => updateAgentModeBackendFields("opencode", { envOverrides: next })}
      hintExamples={["XDG_CONFIG_HOME", "HTTPS_PROXY"]}
    />
  );
};
