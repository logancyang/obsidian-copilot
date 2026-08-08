import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE } from "@/constants";
import CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { logInfo, logError } from "@/logger";
import { App, Notice, PluginSettingTab, type Setting } from "obsidian";
import React from "react";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

interface CopilotSettingDefinition {
  name: string;
  aliases: string[];
  render: (setting: Setting) => void | (() => void);
}

/**
 * Hosts Copilot's React settings surface within both legacy and searchable
 * Obsidian settings lifecycles.
 */
export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Expose the existing React settings application to Obsidian's declarative
   * settings host while retaining `display()` for pre-1.13 installations.
   *
   * @returns Search metadata and a renderer for the Copilot settings surface.
   */
  getSettingDefinitions(): CopilotSettingDefinition[] {
    return [
      {
        name: "Copilot settings",
        aliases: [
          "Basic settings",
          "BYOK models and providers",
          "Miyo semantic search",
          "Agent skills",
          "Custom commands",
          "Self-hosted models",
          "Advanced settings",
        ],
        render: (setting) => {
          setting.settingEl.addClass("copilot-settings-definition");
          return this.renderSettings(setting.settingEl);
        },
      },
    ];
  }

  async reloadPlugin() {
    try {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;

      // Analyze chat messages for memory if enabled
      if (chatView && getSettings().enableRecentConversations) {
        try {
          // Get the current chat model from the chain manager
          const chainManager = this.plugin.projectManager.getCurrentChainManager();
          const chatModel = chainManager.chatModelManager.getChatModel();
          this.plugin.userMemoryManager.addRecentConversation(
            this.plugin.chatUIState.getMessages(),
            chatModel
          );
        } catch (error) {
          logInfo("Failed to analyze chat messages for memory:", error);
        }
      }

      // Autosave the current chat before reloading
      if (chatView && getSettings().autosaveChat) {
        await this.plugin.autosaveCurrentChat();
      }

      // Reload the plugin

      const app = this.plugin.app as unknown as {
        plugins: {
          disablePlugin: (id: string) => Promise<void>;
          enablePlugin: (id: string) => Promise<void>;
        };
        setting: { openTabById: (id: string) => { display: () => void } };
      };
      await app.plugins.disablePlugin("copilot");
      await app.plugins.enablePlugin("copilot");

      app.setting.openTabById("copilot").display();
      new Notice("Plugin reloaded successfully.");
    } catch (error) {
      new Notice("Failed to reload the plugin. Please reload manually.");
      logError("Error reloading plugin:", error);
    }
  }

  display(): void {
    this.renderSettings(this.containerEl);
  }

  private renderSettings(container: HTMLElement): () => void {
    container.empty();
    container.addClass("tw-select-text");
    const div = container.createDiv();
    const root = createPluginRoot(div, this.app);

    root.render(<SettingsMainV2 plugin={this.plugin} />);
    return () => root.unmount();
  }
}
