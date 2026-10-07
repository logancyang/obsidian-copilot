import { STARTUP_LOADING_TEXT } from "@/components/StartupLoadingView";
import CopilotPlugin from "@/main";
import { consumeRequestedCopilotSettingsTab } from "@/settings/openSettings";
import { App, PluginSettingTab } from "obsidian";
import React from "react";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): never[] {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // Copilot registers its settings tab before it finishes starting in the background, so the
    // tab must not render settings that have not loaded yet.
    // https://github.com/logancyang/obsidian-copilot/issues/3518
    if (!this.plugin.isStarted()) {
      containerEl.createDiv({
        cls: "tw-flex tw-items-center tw-justify-center tw-p-8 tw-text-muted",
        text: STARTUP_LOADING_TEXT,
      });
      void this.plugin.whenStarted().then(() => {
        if (this.plugin.isStarted() && containerEl.isConnected) this.display();
      });
      return;
    }
    containerEl.addClass("tw-select-text");
    const div = containerEl.createDiv("div");
    const sections = createPluginRoot(div, this.app);

    sections.render(
      <SettingsMainV2 plugin={this.plugin} initialTab={consumeRequestedCopilotSettingsTab()} />
    );
  }
}
