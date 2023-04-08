import CopilotPlugin from "@/main";
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
      .setDesc(
        createFragment((frag) => {
					frag.appendText("You can find your API key at ");
					frag.createEl('a', {
            text: "https://beta.openai.com/account/api-keys",
            href: "https://beta.openai.com/account/api-keys"
          });
				})
      )
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

    new Setting(defaultModelSettingDiv)
      .setName("Default Model")
      .setDesc(
        createFragment((frag) => {
					frag.appendText("The default model to use, only takes effect when you ");
					frag.createEl('strong', {text: "restart the plugin"});
				})
      )
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