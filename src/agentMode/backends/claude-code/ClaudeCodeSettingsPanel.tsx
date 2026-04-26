import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import { detectBinary, validateExecutableFile } from "@/utils/detectBinary";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import React from "react";
import { ClaudeCodeInstallModal } from "./ClaudeCodeInstallModal";
import { CLAUDE_CODE_BINARY_NAME, updateClaudeCodeFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

export const ClaudeCodeSettingsPanel: React.FC<Props> = ({ app }) => {
  const settings = useSettingsValue();
  const stored = settings.agentMode?.backends?.["claude-code"]?.binaryPath ?? "";
  const [pathInput, setPathInput] = React.useState(stored);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setPathInput(stored);
  }, [stored]);

  const apply = React.useCallback(async (): Promise<void> => {
    const trimmed = pathInput.trim();
    if (!trimmed) {
      setError("Path is required.");
      return;
    }
    const validationError = await validateExecutableFile(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    updateClaudeCodeFields({ binaryPath: trimmed });
    setError(null);
    new Notice("Claude Code binary path saved.");
  }, [pathInput]);

  const clear = React.useCallback((): void => {
    updateClaudeCodeFields({ binaryPath: undefined });
    setPathInput("");
    setError(null);
  }, []);

  const autoDetect = React.useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await detectBinary(CLAUDE_CODE_BINARY_NAME);
      if (!found) {
        setError(
          `${CLAUDE_CODE_BINARY_NAME} not found on PATH. Install with \`npm i -g @agentclientprotocol/claude-agent-acp\` and try again.`
        );
        return;
      }
      setPathInput(found);
      updateClaudeCodeFields({ binaryPath: found });
      new Notice(`Found ${CLAUDE_CODE_BINARY_NAME} at ${found}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      logError("[AgentMode] claude-code auto-detect failed", e);
    } finally {
      setBusy(false);
    }
  }, [busy]);

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
        <div className="tw-flex tw-w-full tw-flex-col tw-gap-2 sm:tw-w-[360px]">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Input
              type="text"
              placeholder="/absolute/path/to/claude-agent-acp"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={autoDetect} disabled={busy}>
              Auto-detect
            </Button>
          </div>
          <div className="tw-flex tw-justify-end">
            <Button variant="default" onClick={apply}>
              Apply
            </Button>
          </div>
          {error && <div className="tw-text-xs tw-text-error">{error}</div>}
        </div>
      </SettingItem>
    </>
  );
};
