import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { useSettingsValue } from "@/settings/model";
import React from "react";
import { updateCodexFields } from "./descriptor";

export const CodexSettingsPanel: React.FC = () => {
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
