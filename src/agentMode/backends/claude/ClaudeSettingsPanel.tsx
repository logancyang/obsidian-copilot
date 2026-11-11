import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { ClaudeAutoMemorySetting } from "@/agentMode/backends/claude/ui/ClaudeAutoMemorySetting";
import { ClaudeAutoModePermissionSetting } from "@/agentMode/backends/claude/ui/ClaudeAutoModePermissionSetting";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { SettingItem } from "@/components/ui/setting-item";
import { err2String } from "@/errorFormat";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { getCachedProjectRecords } from "@/projects/state";
import { useSettingsValue } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { getVaultBase } from "@/utils/vaultPath";
import { Notice, type App } from "obsidian";
import React from "react";
import {
  clearClaudeAutoMemory,
  readClaudeAutoMemory,
  resolveClaudeAutoModePermission,
  updateClaudeFields,
  type ClaudeAutoMemory,
} from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

export const ClaudeSettingsPanel: React.FC<Props> = ({ app }) => {
  const settings = useSettingsValue();
  const vaultBase = getVaultBase(app);
  const [memory, setMemory] = React.useState<ClaudeAutoMemory | null>(null);
  const [memoryReads, setMemoryReads] = React.useState(0);

  React.useEffect(() => {
    if (!vaultBase) return;
    let current = true;
    const path = requireNodeModule<typeof import("node:path")>("path");
    const chatFolders = getCachedProjectRecords().map((record) =>
      path.join(vaultBase, path.dirname(record.filePath))
    );
    readClaudeAutoMemory(settings, vaultBase, chatFolders)
      .then((next) => {
        if (current) setMemory(next);
      })
      .catch((error: unknown) => logError("[Claude] could not read auto memory:", error));
    return () => {
      current = false;
    };
  }, [settings, vaultBase, memoryReads]);

  const confirmClear = (folders: string[]): void => {
    new ConfirmModal(
      app,
      async () => {
        try {
          await clearClaudeAutoMemory(folders);
          new Notice("Cleared Claude's memory for this vault.");
        } catch (error) {
          new Notice(`Couldn't clear Claude's memory. ${err2String(error)}`);
        }
        setMemoryReads((reads) => reads + 1);
      },
      `Delete everything Claude remembers for this vault's chats? This deletes:\n${folders.join("\n")}`,
      "Clear Claude's memory",
      "Clear memory",
      "Cancel",
      undefined,
      "destructive"
    ).open();
  };

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
        value={settings.agentMode?.backends?.claude?.autoMemory}
        onChange={(autoMemory) => updateClaudeFields({ autoMemory })}
        memory={memory}
        onOpenFolder={(folder) => void openWithSystemDefault(folder)}
        onClear={() => memory && confirmClear(memory.folders)}
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
