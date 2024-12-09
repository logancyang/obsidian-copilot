import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE } from "@/constants";
import CopilotPlugin from "@/main";
import { getSettings, updateSetting } from "@/settings/model";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import React from "react";
import { createRoot } from "react-dom/client";
import SettingsMain from "./components/SettingsMain";

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

    sections.render(<SettingsMain plugin={this.plugin} />);

    const devModeHeader = containerEl.createEl("h1", { text: "Additional Settings" });
    devModeHeader.style.marginTop = "40px";

    new Setting(containerEl)
      .setName("Enable Encryption")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Enable encryption for the API keys.");
        })
      )
      .addToggle((toggle) =>
        toggle.setValue(getSettings().enableEncryption).onChange(async (value) => {
          updateSetting("enableEncryption", value);
        })
      );

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Debug mode will log all API requests and prompts to the console.");
        })
      )
      .addToggle((toggle) =>
        toggle.setValue(getSettings().debug).onChange(async (value) => {
          updateSetting("debug", value);
        })
      );
  }
}
