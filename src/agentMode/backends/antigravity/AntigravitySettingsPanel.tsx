import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import type { App } from "obsidian";
import React from "react";
import { updateAntigravityFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

export const AntigravitySettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="Antigravity"
      value={settings.agentMode?.backends?.antigravity?.envOverrides}
      onChange={(next) => updateAntigravityFields({ envOverrides: next })}
      hintExamples={["AGY_BIN", "GOOGLE_APPLICATION_CREDENTIALS"]}
    />
  );
};
