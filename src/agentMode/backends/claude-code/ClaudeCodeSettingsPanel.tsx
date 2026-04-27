import { BinaryPathSetting } from "@/components/agent/BinaryPathSetting";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import React from "react";
import { ClaudeCodeInstallModal } from "./ClaudeCodeInstallModal";
import {
  CLAUDE_CODE_BINARY_NAME,
  CLAUDE_CODE_INSTALL_COMMAND,
  updateClaudeCodeFields,
} from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

export const ClaudeCodeSettingsPanel: React.FC<Props> = ({ app }) => {
  const settings = useSettingsValue();
  const stored = settings.agentMode?.backends?.["claude-code"]?.binaryPath ?? "";

  const onSave = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateClaudeCodeFields({ binaryPath: path });
    new Notice("Claude Code binary path saved.");
    return null;
  }, []);

  const clear = React.useCallback((): void => {
    updateClaudeCodeFields({ binaryPath: undefined });
  }, []);

  const openInstallModal = React.useCallback((): void => {
    new ClaudeCodeInstallModal(app).open();
  }, [app]);

  const description = stored ? (
    <>
      <div>
        Ready — <code>{CLAUDE_CODE_BINARY_NAME}</code> (custom path)
      </div>
      <div className="tw-break-all tw-font-mono tw-text-xs">{stored}</div>
    </>
  ) : (
    <span className="tw-text-warning">
      Setup required — Claude Code binary path not configured.
    </span>
  );

  return (
    <>
      <SettingItem type="custom" title="Claude Code binary" description={description}>
        <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
          {!stored && (
            <Button variant="default" onClick={openInstallModal}>
              Configure
            </Button>
          )}
          {stored && (
            <Button variant="destructive" onClick={clear}>
              Clear path
            </Button>
          )}
        </div>
      </SettingItem>

      <SettingItem
        type="custom"
        title="Custom claude-agent-acp path"
        description="Point Agent Mode at the claude-agent-acp binary. Claude Code inherits auth from your local `claude auth login` credentials."
      >
        <BinaryPathSetting
          binaryName={CLAUDE_CODE_BINARY_NAME}
          placeholder="/absolute/path/to/claude-agent-acp"
          initialPath={stored}
          notFoundHint={`${CLAUDE_CODE_BINARY_NAME} not found on PATH. Install with \`${CLAUDE_CODE_INSTALL_COMMAND}\` and try again.`}
          onSave={onSave}
          persistOnAutoDetect
        />
      </SettingItem>
    </>
  );
};
