import CopilotPlugin from "./main";
import { App, PluginSettingTab, Setting, DropdownComponent } from "obsidian";

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Your OpenAI API key")
      .addText((text) =>{
        text.inputEl.type = "password";
        text.inputEl.style.width = "80%";
        text
          .setPlaceholder("OpenAI API key")
          .setValue(this.plugin.settings.openAiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAiApiKey = value;
            await this.plugin.saveSettings();
          })
        }
      );

    new Setting(containerEl)
      .setName("Default Model")
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown
          .addOption('gpt-3.5-turbo', 'GPT-3.5')
          .addOption('gpt-4', 'GPT-4')
          .setValue(this.plugin.settings.defaultModel || 'gpt-3.5-turbo')
          .onChange(async (value: string) => {
            this.plugin.settings.defaultModel = value;
            await this.plugin.saveSettings();
          });
      });

    const apiDescEl = containerEl.createEl('div', {
      cls: 'setting-item-description',
      text: 'You can find your API key at https://beta.openai.com/account/api-keys',
    });
    apiDescEl.style.userSelect = 'text';
  }
}