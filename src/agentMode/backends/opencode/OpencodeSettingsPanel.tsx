import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import type CopilotPlugin from "@/main";
import { updateAgentModeBackendFields, useSettingsValue } from "@/settings/model";
import type { App } from "obsidian";
import React from "react";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

/**
 * OpenCode card extras. Binary install / detection / path configuration lives
 * in the Configure dialog (`OpencodeInstallModal`, opened via
 * `descriptor.openInstallUI`); this panel only hosts the spawn-time
 * environment-variable overrides that remain on the settings card.
 */
export const OpencodeSettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="opencode"
      value={settings.agentMode?.backends?.opencode?.envOverrides}
      onChange={(next) => updateAgentModeBackendFields("opencode", { envOverrides: next })}
      hintExamples={["XDG_CONFIG_HOME", "HTTPS_PROXY"]}
    />
  );
};
