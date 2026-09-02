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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tw-select-text");
    const div = containerEl.createDiv("div");
    const sections = createPluginRoot(div, this.app);

    sections.render(
      <SettingsMainV2 plugin={this.plugin} initialTab={consumeRequestedCopilotSettingsTab()} />
    );
  }
}
