import CopilotView from "@/components/CopilotView";
import { CHAT_VIEWTYPE } from "@/constants";
import CopilotPlugin from "@/main";
import { getSettings, updateSetting } from "@/settings/model";
import { App, Notice, PluginSettingTab, Setting, ToggleComponent } from "obsidian";
import React from "react";
import { createRoot } from "react-dom/client";
import SettingsMain from "./components/SettingsMain";

interface RagSettingItemProps {
  name: string;
  description: string;
  type: "number" | "checkbox" | "text";
  settingKey: string;
  min?: number;
  max?: number;
  step?: number;
}

const RagSettingItem: React.FC<RagSettingItemProps> = ({
  name,
  description,
  type,
  settingKey,
  min,
  max,
  step,
}) => {
  const settings = getSettings();
  const value = settings[settingKey as keyof typeof settings];

  const handleChange = (newValue: string | number | boolean) => {
    if (type === "number") {
      updateSetting(
        settingKey as any,
        typeof newValue === "string" ? parseFloat(newValue) : newValue
      );
    } else {
      updateSetting(settingKey as any, newValue);
    }
  };

  return (
    <div className="setting-item">
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        <div className="setting-item-description">{description}</div>
      </div>
      <div className="setting-item-control">
        {type === "checkbox" ? (
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => handleChange(e.target.checked)}
          />
        ) : type === "number" ? (
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value as number}
            onChange={(e) => handleChange(e.target.value)}
          />
        ) : (
          <input
            type="text"
            value={value as string}
            onChange={(e) => handleChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
};

const RagSettingsSection: React.FC = () => {
  return (
    <div className="copilot-settings-section">
      <h2>Retrieval Settings</h2>

      <RagSettingItem
        name="Minimum Similarity Score"
        description="Minimum similarity score for document retrieval (0-1)"
        type="number"
        settingKey="ragMinSimilarityScore"
        min={0}
        max={1}
        step={0.1}
      />

      <RagSettingItem
        name="Maximum Results"
        description="Maximum number of documents to retrieve"
        type="number"
        settingKey="ragMaxK"
        min={1}
        max={50}
        step={1}
      />

      <RagSettingItem
        name="Hybrid Search Weight"
        description="Balance between semantic and keyword search (0 = semantic only, 1 = keyword only)"
        type="number"
        settingKey="ragTextWeight"
        min={0}
        max={1}
        step={0.1}
      />

      <RagSettingItem
        name="Show Sources"
        description="Include source references in responses"
        type="checkbox"
        settingKey="ragShowSources"
      />

      <RagSettingItem
        name="Include Metadata"
        description="Include additional metadata in responses"
        type="checkbox"
        settingKey="ragIncludeMetadata"
      />

      <details className="copilot-settings-advanced">
        <summary>Advanced Retrieval Settings</summary>

        <RagSettingItem
          name="Reranker Temperature"
          description="Temperature for reranking model (0-1)"
          type="number"
          settingKey="ragRerankerTemp"
          min={0}
          max={1}
          step={0.1}
        />

        <RagSettingItem
          name="Reranker Threshold"
          description="Minimum score for reranking results (0-1)"
          type="number"
          settingKey="ragRerankerThreshold"
          min={0}
          max={1}
          step={0.1}
        />

        <RagSettingItem
          name="Maximum Tokens"
          description="Maximum number of tokens to include in context"
          type="number"
          settingKey="ragMaxTokens"
          min={100}
          max={10000}
          step={100}
        />

        <RagSettingItem
          name="Custom RAG Prompt Template"
          description="Custom template for RAG responses (leave empty for default)"
          type="text"
          settingKey="ragCustomPrompt"
        />

        <RagSettingItem
          name="Enable RAG Debug"
          description="Show detailed retrieval debugging information"
          type="checkbox"
          settingKey="ragEnableDebug"
        />
      </details>
    </div>
  );
};

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async reloadPlugin() {
    try {
      const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]?.view as CopilotView;
      if (chatView && getSettings().autosaveChat) {
        await this.plugin.autosaveCurrentChat();
      }

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

    // Render React components
    sections.render(
      <>
        <SettingsMain plugin={this.plugin} />
        <RagSettingsSection />
      </>
    );

    // Add additional settings using Obsidian's Setting class
    const additionalSettingsHeader = containerEl.createEl("h1", {
      text: "Additional Settings",
      cls: "additional-settings-header",
    });
    additionalSettingsHeader.style.marginTop = "40px";

    // Encryption Setting
    new Setting(containerEl)
      .setName("Enable Encryption")
      .setDesc("Enable encryption for the API keys.")
      .addToggle((toggle: ToggleComponent) => {
        toggle.setValue(getSettings().enableEncryption).onChange(async (value: boolean) => {
          updateSetting("enableEncryption", value);
        });
      });

    // Debug Setting
    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Debug mode will log all API requests and prompts to the console.")
      .addToggle((toggle: ToggleComponent) => {
        toggle.setValue(getSettings().debug).onChange(async (value: boolean) => {
          updateSetting("debug", value);
        });
      });
  }
}
