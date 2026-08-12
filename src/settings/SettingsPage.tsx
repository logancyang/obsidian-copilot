import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE } from "@/constants";
import CopilotPlugin from "@/main";
import { getSettings } from "@/settings/model";
import { logInfo, logError } from "@/logger";
import { App, Notice, PluginSettingTab, type Setting } from "obsidian";
import React from "react";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { settingsSearchAnchor } from "@/lib/settingsSearchAnchor";
import {
  requestSettingsDeepLink,
  SETTINGS_SEARCH_MANIFEST,
  type SettingsSearchEntry,
} from "@/settings/v2/settingsSearch";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

/**
 * Structural subset of Obsidian 1.13's `SettingDefinition` contract. The
 * pinned `obsidian` typings predate the declarative settings API (bumping
 * them is blocked by exact-peer conflicts), so the members Copilot uses are
 * declared locally; assignment-compatible with the real declarations once
 * the typings catch up.
 */
export interface CopilotSettingDefinition {
  name: string;
  desc?: string;
  aliases?: string[];
  searchable?: boolean;
  render: (setting: Setting) => void | (() => void);
}

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;
  private searchEntryByDefinition = new Map<CopilotSettingDefinition, SettingsSearchEntry>();

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
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

  /**
   * Declarative definitions for Obsidian 1.13+ (settings search and tab
   * rendering). The first definition hosts the whole React settings app;
   * the rest are hidden, search-only markers derived from the manifest.
   * When these are returned, Obsidian renders the tab from them and never
   * calls `display()` — that method stays only as the pre-1.13 fallback.
   */
  getSettingDefinitions(): CopilotSettingDefinition[] {
    this.searchEntryByDefinition = new Map();

    const appHost: CopilotSettingDefinition = {
      name: "Copilot settings",
      searchable: false,
      render: (setting) => this.mountSettingsApp(setting),
    };

    const markers = SETTINGS_SEARCH_MANIFEST.map((entry) => {
      const definition: CopilotSettingDefinition = {
        name: entry.name,
        desc: entry.desc,
        aliases: entry.aliases ? [...entry.aliases] : undefined,
        // The row exists so Obsidian can index and target the definition;
        // the visible UI for the setting lives inside the React app.
        render: (setting) => {
          setting.settingEl.classList.add("copilot-setting-search-marker");
        },
      };
      this.searchEntryByDefinition.set(definition, entry);
      return definition;
    });

    return [appHost, ...markers];
  }

  /**
   * Called by Obsidian when a settings-search result for this tab is chosen.
   * Marker rows are hidden, so instead of handing Obsidian an element to
   * scroll to, this routes the target through the deep-link channel — the
   * React app switches to the mapped tab and scrolls the anchored row into
   * view. Returning undefined makes Obsidian skip its own scroll/focus.
   * @param definition The chosen search result's definition object.
   */
  getElementForDefinition(definition: CopilotSettingDefinition): HTMLElement | undefined {
    const entry = this.searchEntryByDefinition.get(definition);
    if (!entry) return undefined;
    requestSettingsDeepLink({ tabId: entry.tabId, anchor: settingsSearchAnchor(entry.name) });
    return undefined;
  }

  /**
   * Mounts the React settings app into the host definition's row, undoing
   * the standard setting-row chrome. Returns the cleanup Obsidian invokes
   * when the row is torn down (tab switch or modal close).
   */
  private mountSettingsApp(setting: Setting): () => void {
    const host = setting.settingEl;
    host.empty();
    host.classList.add("copilot-settings-app-host", "tw-select-text");
    // The enclosing `.setting-items` list paints a card (background + border)
    // around its rows; tag it so the app isn't framed inside one.
    host.parentElement?.classList.add("copilot-settings-app-items");
    const root = createPluginRoot(host, this.app);
    root.render(<SettingsMainV2 plugin={this.plugin} />);
    return () => root.unmount();
  }

  /**
   * Pre-1.13 fallback: Obsidian only calls this when `getSettingDefinitions`
   * is unsupported (or returns nothing); newer versions render declaratively.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tw-select-text");
    const div = containerEl.createDiv("div");
    const sections = createPluginRoot(div, this.app);

    sections.render(<SettingsMainV2 plugin={this.plugin} />);
  }
}
