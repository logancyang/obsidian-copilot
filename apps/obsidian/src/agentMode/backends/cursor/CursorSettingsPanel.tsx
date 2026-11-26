import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { useSettingsValue } from "@/settings/model";
import React from "react";
import { updateCursorFields } from "./descriptor";

export const CursorSettingsPanel: React.FC = () => {
  const settings = useSettingsValue();
  return (
    <EnvOverridesSetting
      backendDisplayName="Cursor"
      value={settings.agentMode?.backends?.cursor?.envOverrides}
      onChange={(next) => updateCursorFields({ envOverrides: next })}
      hintExamples={["HTTPS_PROXY", "NO_PROXY"]}
    />
  );
};
