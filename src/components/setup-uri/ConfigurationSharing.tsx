import React from "react";
import { ArrowUpFromLine, ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SetupUriExportModal } from "@/components/modals/SetupUriExportModal";
import { SetupUriImportModal } from "@/components/modals/SetupUriImportModal";
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
    new SetupUriExportModal(app, pluginVersion).open();
  };

  const handleImport = () => {
    const copilotPlugin = getCopilotPlugin();
    if (!copilotPlugin) {
      new Notice("Cannot import: Copilot plugin instance not found.");
      return;
    }
    new SetupUriImportModal(app, (data) => copilotPlugin.saveData(data)).open();
  };

  return (
    <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
      <div className="tw-flex tw-flex-col tw-gap-1">
        <div className="tw-text-xl tw-font-bold">Configuration Sharing</div>
        <div className="tw-text-xs tw-leading-relaxed tw-text-muted">
          Transfer your Copilot configuration (including API keys and preferences) between vaults
          using an encrypted Setup URI.
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
              Create an encrypted URI of your current settings to use in another vault.
            </div>
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={handleExport} className="tw-shrink-0">
          Export Setup URI
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
              Manually import settings from a Setup URI if the protocol link doesn&apos;t work.
            </div>
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={handleImport} className="tw-shrink-0">
          Import Setup URI
        </Button>
      </div>
    </section>
  );
};
