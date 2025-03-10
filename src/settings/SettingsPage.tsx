import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE } from "@/constants";
import CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { App, Notice, PluginSettingTab } from "obsidian";
import React from "react";
import { createRoot } from "react-dom/client";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { ContainerContext } from "@/settings/v2/components/ContainerContext";

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async reloadPlugin() {
    try {
      // Autosave the current chat before reloading
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView && getSettings().autosaveChat) {
        await this.plugin.autosaveCurrentChat();
      }

      // Reload the plugin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const app = this.plugin.app as any;
      await app.plugins.disablePlugin("copilot");
      await app.plugins.enablePlugin("copilot");

      app.setting.openTabById("copilot").display();
      new Notice("Plugin reloaded successfully.");
    } catch (error) {
      new Notice("Failed to reload the plugin. Please reload manually.");
      console.error("Error reloading plugin:", error);
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.style.userSelect = "text";
    const div = containerEl.createDiv("div");
    const sections = createRoot(div);

    sections.render(
      <ContainerContext.Provider value={containerEl}>
        <SettingsMainV2 plugin={this.plugin} />
      </ContainerContext.Provider>
    );
  }
}
