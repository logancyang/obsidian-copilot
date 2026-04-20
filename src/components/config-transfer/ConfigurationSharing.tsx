import React from "react";
import { ArrowUpFromLine, ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ConfigExportModal } from "@/components/modals/ConfigExportModal";
import { ConfigImportModal } from "@/components/modals/ConfigImportModal";
import { Notice } from "obsidian";

/** Resolve the Copilot plugin instance from the global `app`. */
function getCopilotPlugin() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugins = (app as any).plugins;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return plugins?.getPlugin?.("copilot") ?? plugins?.plugins?.copilot;
}

/**
 * Configuration Sharing section for Advanced Settings.
 * Provides Export and Import buttons that open Obsidian modals with stepper UIs.
 */
export const ConfigurationSharing: React.FC = () => {
  const handleExport = () => {
    const copilotPlugin = getCopilotPlugin();
    const pluginVersion = copilotPlugin?.manifest?.version ?? "unknown";
    new ConfigExportModal(app, pluginVersion).open();
  };

  const handleImport = () => {
    const copilotPlugin = getCopilotPlugin();
    if (!copilotPlugin) {
      new Notice("Cannot import: Copilot plugin instance not found.");
      return;
    }
    new ConfigImportModal(app, (data) => copilotPlugin.saveData(data)).open();
  };

  return (
    <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
      <div className="tw-flex tw-flex-col tw-gap-1">
        <div className="tw-text-xl tw-font-bold">Configuration Sharing</div>
        <div className="tw-text-xs tw-leading-relaxed tw-text-muted">
          Transfer your Copilot settings, API keys, and selected Copilot files between vaults using
          an encrypted configuration file. Imported files are restored into this vault&apos;s
          current Copilot folders.
        </div>
      </div>

      <Separator />

      {/* Export Row */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-3">
          <div className="tw-flex tw-size-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-lg tw-bg-interactive-accent/10">
            <ArrowUpFromLine className="tw-size-4 tw-text-accent" />
          </div>
          <div className="tw-min-w-0">
            <div className="tw-text-sm tw-font-medium tw-text-normal">Export Configuration</div>
            <div className="tw-truncate tw-text-xs tw-text-muted">
              Save settings, API keys, and selected Copilot files as an encrypted file.
            </div>
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={handleExport} className="tw-shrink-0">
          Export
        </Button>
      </div>

      <Separator />

      {/* Import Row */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-3">
          <div className="tw-flex tw-size-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-lg tw-bg-interactive-accent/10">
            <ArrowDownToLine className="tw-size-4 tw-text-accent" />
          </div>
          <div className="tw-min-w-0">
            <div className="tw-text-sm tw-font-medium tw-text-normal">Import Configuration</div>
            <div className="tw-truncate tw-text-xs tw-text-muted">
              Restore settings and files into this vault&apos;s current Copilot folders.
            </div>
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={handleImport} className="tw-shrink-0">
          Import
        </Button>
      </div>
    </section>
  );
};
