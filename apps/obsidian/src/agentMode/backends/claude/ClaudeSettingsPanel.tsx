import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { ClaudeAutoMemorySetting } from "@/agentMode/backends/claude/ui/ClaudeAutoMemorySetting";
import { ClaudeAutoModePermissionSetting } from "@/agentMode/backends/claude/ui/ClaudeAutoModePermissionSetting";
import { SettingItem } from "@/components/ui/setting-item";
import type { App, PluginManifest } from "obsidian";
import { useSettingsValue } from "@/settings/model";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { getVaultBase } from "@/utils/vaultPath";
import React from "react";
import {
  findClaudeAutoMemoryFolder,
  resolveClaudeAutoModePermission,
  updateClaudeFields,
} from "./descriptor";

interface Props {
  app: App;
  manifest: PluginManifest;
}

export const ClaudeSettingsPanel: React.FC<Props> = ({ app, manifest }) => {
  const settings = useSettingsValue();
  const vaultBase = getVaultBase(app);
  const clientVersion = manifest.version;
  const autoMemory = settings.agentMode?.backends?.claude?.autoMemory;
  const envOverridesKey = JSON.stringify(settings.agentMode?.backends?.claude?.envOverrides ?? {});
  const [memoryFolder, setMemoryFolder] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!vaultBase) return;
    let current = true;
    void findClaudeAutoMemoryFolder(vaultBase, clientVersion).then((folder) => {
      if (current) setMemoryFolder(folder);
    });
    return () => {
      current = false;
    };
  }, [vaultBase, clientVersion, autoMemory, envOverridesKey]);

  return (
    <>
      <ClaudeAutoModePermissionSetting
        value={resolveClaudeAutoModePermission(settings)}
        onChange={(autoModePermission) => updateClaudeFields({ autoModePermission })}
      />

      <SettingItem
        type="switch"
        title="Show extended thinking"
        description="Show the model's reasoning as it works. Uses more tokens."
        checked={Boolean(settings.agentMode?.backends?.claude?.enableThinking)}
        onCheckedChange={(checked) => updateClaudeFields({ enableThinking: checked })}
      />

      <ClaudeAutoMemorySetting
        value={autoMemory}
        onChange={(next) => updateClaudeFields({ autoMemory: next })}
        memoryFolder={memoryFolder}
        onOpen={(folder) => void openWithSystemDefault(folder)}
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
