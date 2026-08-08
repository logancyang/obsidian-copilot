import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import type { App } from "obsidian";
import React from "react";
import { updateCodexFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

/**
 * Codex card extras. The codex-acp install / path / auth configuration lives
 * in the Configure dialog (`CodexInstallModal`, opened via
 * `descriptor.openInstallUI`); this panel only hosts the spawn-time
 * environment-variable overrides that remain on the settings card.
 */
export const CodexSettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="Codex"
      value={settings.agentMode?.backends?.codex?.envOverrides}
      onChange={(next) => updateCodexFields({ envOverrides: next })}
      hintExamples={["CODEX_HOME", "OPENAI_BASE_URL"]}
    />
  );
};
