import CopilotPlugin from "src/main";
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

    const apiKeySettingDiv = containerEl.createEl('div');
    const defaultModelSettingDiv = containerEl.createEl('div');
    defaultModelSettingDiv.style.marginTop = '2rem';

    new Setting(apiKeySettingDiv)
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

    const apiDescEl = apiKeySettingDiv.createEl('div', {
      cls: 'setting-item-description',
      text: 'You can find your API key at https://beta.openai.com/account/api-keys',
    });
    apiDescEl.style.userSelect = 'text';

    new Setting(defaultModelSettingDiv)
      .setName("Default Model")
      .setDesc("The default model to use, *only takes effect when you create a new chat or restart the plugin*.")
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown
          .addOption('gpt-3.5-turbo', 'GPT-3.5')
          .addOption('gpt-4', 'GPT-4')
          .setValue(this.plugin.settings.defaultModel)
          .onChange(async (value: string) => {
            this.plugin.settings.defaultModel = value;
            await this.plugin.saveSettings();
          });
      });
  }
}