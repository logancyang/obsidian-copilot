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

/**
 * Antigravity card extras. The antigravity-acp install / path / auth configuration lives
 * in the Configure dialog (`AntigravityInstallModal`, opened via
 * `descriptor.openInstallUI`); this panel only hosts the spawn-time
 * environment-variable overrides that remain on the settings card.
 */
export const AntigravitySettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="Antigravity"
      value={settings.agentMode?.backends?.antigravity?.envOverrides}
      onChange={(next) => updateAntigravityFields({ envOverrides: next })}
      hintExamples={["GEMINI_API_KEY", "ANTIGRAVITY_CONFIG_DIR"]}
    />
  );
};
