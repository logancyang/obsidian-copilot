import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { SettingItem } from "@/components/ui/setting-item";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import type { App } from "obsidian";
import React from "react";
import { updateClaudeFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

/**
 * Claude card extras. CLI detection / path / auth configuration lives in the
 * Configure dialog (`ClaudeInstallModal`, opened via
 * `descriptor.openInstallUI`); this panel hosts the model-behavior toggle and
 * spawn-time environment overrides that remain on the settings card.
 */
export const ClaudeSettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  return (
    <>
      <SettingItem
        type="switch"
        title="Show extended thinking"
        description="Stream the model's reasoning blocks during a turn. Increases token usage."
        checked={Boolean(settings.agentMode?.backends?.claude?.enableThinking)}
        onCheckedChange={(checked) => updateClaudeFields({ enableThinking: checked })}
      />

      <EnvOverridesSetting
        backendDisplayName="Claude"
        value={settings.agentMode?.backends?.claude?.envOverrides}
        onChange={(next) => updateClaudeFields({ envOverrides: next })}
        hintExamples={["CLAUDE_CONFIG_DIR", "HTTPS_PROXY"]}
      />
    </>
  );
};
