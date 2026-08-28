import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import React from "react";
import { updateAntigravityFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
}

/** Spawn-time environment overrides for the official `agy` CLI. */
export const AntigravitySettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="Antigravity"
      value={settings.agentMode?.backends?.antigravity?.envOverrides}
      onChange={(next) => updateAntigravityFields({ envOverrides: next })}
      hintExamples={["ANTIGRAVITY_HOME", "HTTP_PROXY"]}
    />
  );
};
