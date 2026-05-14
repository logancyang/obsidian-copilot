import { BinaryPathSetting } from "@/components/agent/BinaryPathSetting";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { Notice } from "obsidian";
import React from "react";

export interface SimpleBackendSettingsPanelProps {
  /** Lower-case display name (e.g. "Claude Code"). */
  displayName: string;
  /** Binary lookup name (e.g. "claude-agent-acp"). */
  binaryName: string;
  /** Shell command users can run to install the binary. */
  installCommand: string;
  /** Placeholder for the binary-path input. */
  pathPlaceholder: string;
  /** Title of the custom-path SettingItem. */
  customPathTitle: string;
  /** Description of the custom-path SettingItem. */
  customPathDescription: string;
  /** Read the configured binary path from current settings. */
  readStoredPath: () => string;
  /** Persist `path` (or clear when `undefined`) back to settings. */
  persistPath: (path: string | undefined) => void;
  /** Open the matching install modal. */
  openInstallModal: () => void;
}

/**
 * Settings panel for backends whose configuration is a single binary path
 * (Claude Code, Codex). Manages the "Configure / Clear path" SettingItem
 * plus a custom-path entry.
 */
export const SimpleBackendSettingsPanel: React.FC<SimpleBackendSettingsPanelProps> = ({
  displayName,
  binaryName,
  installCommand,
  pathPlaceholder,
  customPathTitle,
  customPathDescription,
  readStoredPath,
  persistPath,
  openInstallModal,
}) => {
  // Re-render whenever settings change.
  useSettingsValue();
  const stored = readStoredPath();

  const onSave = React.useCallback(
    async (path: string): Promise<string | null> => {
      const err = await validateExecutableFile(path);
      if (err) return err;
      persistPath(path);
      new Notice(`${displayName} binary path saved.`);
      return null;
    },
    [displayName, persistPath]
  );

  const clear = React.useCallback((): void => {
    persistPath(undefined);
  }, [persistPath]);

  const description = stored ? (
    <>
      <div>
        Ready — <code>{binaryName}</code> (custom path)
      </div>
      <div className="tw-break-all tw-font-mono tw-text-xs">{stored}</div>
    </>
  ) : (
    <span className="tw-text-warning">
      Setup required — {displayName} binary path not configured.
    </span>
  );

  return (
    <>
      <SettingItem type="custom" title={`${displayName} binary`} description={description}>
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

      <SettingItem type="custom" title={customPathTitle} description={customPathDescription}>
        <BinaryPathSetting
          binaryName={binaryName}
          placeholder={pathPlaceholder}
          initialPath={stored}
          notFoundHint={`${binaryName} not found on PATH. Install with \`${installCommand}\` and try again.`}
          onSave={onSave}
          persistOnAutoDetect
        />
      </SettingItem>
    </>
  );
};
