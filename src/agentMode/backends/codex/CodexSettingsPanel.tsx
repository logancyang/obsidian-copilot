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
