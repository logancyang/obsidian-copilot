import { OpencodeInstallModal } from "@/agentMode/backends/opencode/OpencodeInstallModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import { detectBinary } from "@/utils/detectBinary";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import React from "react";
import { computeInstallState, type InstallState } from "./OpencodeBinaryManager";
import { getOpencodeBinaryManager } from "./descriptor";
import { mapNodeArch, mapNodePlatform } from "./platformResolver";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

function renderStatusDescription(state: InstallState): React.ReactNode {
  if (state.kind === "absent") {
    return <span className="tw-text-warning">Setup required — opencode is not installed.</span>;
  }
  return (
    <>
      <div>
        Ready — opencode <code>v{state.version}</code>
        {state.source === "custom" && <span className="tw-text-muted"> (custom)</span>}
      </div>
      <div className="tw-break-all tw-font-mono tw-text-xs">{state.path}</div>
    </>
  );
}

/**
 * OpenCode-specific settings panel. Lives in the OpenCode backend folder so
 * the generic Agent Mode settings tab stays backend-agnostic — it just
 * renders `descriptor.SettingsPanel`.
 */
export const OpencodeSettingsPanel: React.FC<Props> = ({ plugin, app }) => {
  const settings = useSettingsValue();
  const manager = getOpencodeBinaryManager(plugin);
  const [customPathInput, setCustomPathInput] = React.useState("");
  const [customPathError, setCustomPathError] = React.useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [detecting, setDetecting] = React.useState(false);

  const installState = computeInstallState(settings.agentMode?.backends?.opencode);

  const openInstallModal = (): void => {
    new OpencodeInstallModal(app, manager, {
      platform: mapNodePlatform(process.platform) ?? process.platform,
      arch: mapNodeArch(process.arch) ?? process.arch,
    }).open();
  };

  const handleUninstall = (): void => {
    new ConfirmModal(
      app,
      async () => {
        try {
          await manager.uninstall();
          new Notice("opencode uninstalled.");
        } catch (e) {
          logError("[AgentMode] uninstall failed", e);
          new Notice(`Uninstall failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      "Remove the installed opencode binary? Your BYOK keys and MCP config will be kept.",
      "Uninstall opencode",
      "Uninstall"
    ).open();
  };

  const applyCustomPath = async (): Promise<void> => {
    const trimmed = customPathInput.trim();
    if (!trimmed) {
      setCustomPathError("Path is required.");
      return;
    }
    try {
      await manager.setCustomBinaryPath(trimmed);
      setCustomPathError(null);
      new Notice("Custom opencode binary path saved.");
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearCustomPath = async (): Promise<void> => {
    await manager.setCustomBinaryPath(null);
    setCustomPathError(null);
    setCustomPathInput("");
  };

  const autoDetect = async (): Promise<void> => {
    setDetecting(true);
    setCustomPathError(null);
    try {
      const found = await detectBinary("opencode");
      if (!found) {
        setCustomPathError(
          "opencode not found on PATH. Install it or paste a custom path manually."
        );
        return;
      }
      setCustomPathInput(found);
      try {
        await manager.setCustomBinaryPath(found);
        new Notice(`Found opencode at ${found}`);
      } catch (e) {
        setCustomPathError(e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      logError("[AgentMode] opencode auto-detect failed", e);
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  };

  return (
    <>
      <SettingItem
        type="custom"
        title="opencode binary"
        description={renderStatusDescription(installState)}
      >
        <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
          {installState.kind === "absent" && (
            <Button variant="default" onClick={openInstallModal}>
              Install opencode
            </Button>
          )}
          {installState.kind === "installed" && installState.source === "managed" && (
            <>
              <Button variant="secondary" onClick={openInstallModal}>
                Reinstall
              </Button>
              <Button variant="destructive" onClick={handleUninstall}>
                Uninstall
              </Button>
            </>
          )}
          {installState.kind === "installed" && installState.source === "custom" && (
            <Button variant="secondary" onClick={clearCustomPath}>
              Clear custom path
            </Button>
          )}
        </div>
      </SettingItem>

      {!(installState.kind === "installed" && installState.source === "custom") && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced((s) => !s)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? "▾ Advanced" : "▸ Advanced"}
          </Button>
          {showAdvanced && (
            <SettingItem
              type="custom"
              title="Use custom opencode binary path"
              description="Skip the managed install and point Agent Mode at a binary you already have on disk. Useful for self-builders or air-gapped machines."
            >
              <div className="tw-flex tw-w-full tw-flex-col tw-gap-2 sm:tw-w-[360px]">
                <div className="tw-flex tw-items-center tw-gap-2">
                  <Input
                    type="text"
                    placeholder="/absolute/path/to/opencode"
                    value={customPathInput}
                    onChange={(e) => setCustomPathInput(e.target.value)}
                  />
                  <Button variant="secondary" size="sm" onClick={autoDetect} disabled={detecting}>
                    Auto-detect
                  </Button>
                </div>
                <div className="tw-flex tw-justify-end">
                  <Button variant="default" onClick={applyCustomPath}>
                    Apply
                  </Button>
                </div>
                {customPathError && (
                  <div className="tw-text-xs tw-text-error">{customPathError}</div>
                )}
              </div>
            </SettingItem>
          )}
        </div>
      )}
    </>
  );
};
