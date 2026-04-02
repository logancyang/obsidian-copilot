/**
 * Obsidian Modal shell for exporting Copilot configuration as an encrypted .copilot file.
 * Renders the ExportStepperContent React component inside the modal.
 */

import { ExportStepperContent } from "@/components/config-transfer/ExportStepperContent";
import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

export class ConfigExportModal extends Modal {
  private root?: Root;
  private pluginVersion: string;

  constructor(app: App, pluginVersion: string) {
    super(app);
    this.pluginVersion = pluginVersion;
  }

  onOpen(): void {
    this.root = createRoot(this.contentEl);
    this.root.render(
      <ExportStepperContent app={this.app} pluginVersion={this.pluginVersion} />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = undefined;
  }
}
