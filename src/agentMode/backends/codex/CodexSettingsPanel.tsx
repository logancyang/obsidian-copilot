import { BinaryPathSetting } from "@/components/agent/BinaryPathSetting";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import React from "react";
import { CodexInstallModal } from "./CodexInstallModal";
import { CODEX_BINARY_NAME, CODEX_INSTALL_COMMAND, updateCodexFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

export const CodexSettingsPanel: React.FC<Props> = ({ app }) => {
  const settings = useSettingsValue();
  const stored = settings.agentMode?.backends?.codex?.binaryPath ?? "";

  const onSave = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    updateCodexFields({ binaryPath: path });
    new Notice("Codex binary path saved.");
    return null;
  }, []);

  const clear = React.useCallback((): void => {
    updateCodexFields({ binaryPath: undefined });
  }, []);

  const openInstallModal = React.useCallback((): void => {
    new CodexInstallModal(app).open();
  }, [app]);

  const description = stored ? (
    <>
      <div>
        Ready — <code>{CODEX_BINARY_NAME}</code> (custom path)
      </div>
      <div className="tw-break-all tw-font-mono tw-text-xs">{stored}</div>
    </>
  ) : (
    <span className="tw-text-warning">Setup required — Codex binary path not configured.</span>
  );

  return (
    <>
      <SettingItem type="custom" title="Codex binary" description={description}>
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
        title="Custom codex-acp path"
        description="Point Agent Mode at the codex-acp binary. Codex inherits auth from your local `codex login` credentials, or from `OPENAI_API_KEY` / `CODEX_API_KEY` exported in your shell."
      >
        <BinaryPathSetting
          binaryName={CODEX_BINARY_NAME}
          placeholder="/absolute/path/to/codex-acp"
          initialPath={stored}
          notFoundHint={`${CODEX_BINARY_NAME} not found on PATH. Install with \`${CODEX_INSTALL_COMMAND}\` and try again.`}
          onSave={onSave}
          persistOnAutoDetect
        />
      </SettingItem>
    </>
  );
};
