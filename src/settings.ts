import { DEFAULT_SETTINGS } from "@/constants";
import CopilotPlugin from "@/main";
import { App, DropdownComponent, Notice, PluginSettingTab, Setting } from "obsidian";

export class CopilotSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', {text: 'Copilot Settings'});

    containerEl.createEl('button', {
      text: 'Reset to default settings',
      type: 'button',
      cls: 'mod-cta',
    }).addEventListener('click', async () => {
      this.plugin.settings = DEFAULT_SETTINGS;
      await this.plugin.saveSettings();
      new Notice('Settings have been reset to their default values.');
    });

    containerEl.createEl('h6',
      {text: 'Please reload the plugin when you change any setting below.'}
    );

    containerEl.createEl('h4', {text: 'OpenAI API Settings'});

    new Setting(containerEl)
      .setName("Your OpenAI API key")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("You can find your API key at ");
          frag.createEl('a', {
            text: "https://beta.openai.com/account/api-keys",
            href: "https://beta.openai.com/account/api-keys"
          });
          frag.createEl('br');
          frag.appendText(
            "It is stored locally in your vault at "
          );
          frag.createEl(
            'strong',
            {text: "path_to_your_vault/.obsidian/plugins/obsidian-copilot/data.json"}
          );
          frag.appendText(", and it is only used to make requests to OpenAI.");
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Streaming mode")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Stream the response from the API as it comes in. It can take a while for the API to respond, so keeping it on is recommended.");
        })
      )
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown
          .addOption('true', 'On')
          .addOption('false', 'Off')
          .setValue(this.plugin.settings.stream ? 'true' : 'false')
          .onChange(async (value: string) => {
            this.plugin.settings.stream = value === 'true';
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl(
      'h6',
      {
        text: 'Please be mindful of the number of tokens and context conversation turns you set here, as they will affect the cost of your API requests.'
      }
    );

    new Setting(containerEl)
      .setName("Temperature")
      .setDesc(
        createFragment((frag) => {
          frag.appendText(
            "Default is 0.7. Higher values will result in more creativeness, but also more mistakes. Set to 0 for no randomness."
          );
        })
      )
      .addText((text) =>{
        text.inputEl.type = "number";
        text
          .setPlaceholder("0.7")
          .setValue(this.plugin.settings.temperature)
          .onChange(async (value) => {
            this.plugin.settings.temperature = value;
            await this.plugin.saveSettings();
          })
        }
      );

    new Setting(containerEl)
      .setName("Token limit")
      .setDesc(
        createFragment((frag) => {
          frag.appendText(
            "The maximum number of tokens to generate. Default is 1000."
          );
        })
      )
      .addText((text) =>{
        text.inputEl.type = "number";
        text
          .setPlaceholder("1000")
          .setValue(this.plugin.settings.maxTokens)
          .onChange(async (value) => {
            this.plugin.settings.maxTokens = value;
            await this.plugin.saveSettings();
          })
        }
      );

    new Setting(containerEl)
      .setName("Conversation turns in context")
      .setDesc(
        createFragment((frag) => {
          frag.appendText(
            "The number of previous conversation turns to include in the context. Default is 3 turns, i.e. 6 messages."
          );
        })
      )
      .addText((text) =>{
        text.inputEl.type = "number";
        text
          .setPlaceholder("3")
          .setValue(this.plugin.settings.contextTurns)
          .onChange(async (value) => {
            this.plugin.settings.contextTurns = value;
            await this.plugin.saveSettings();
          })
        }
      );

    // TODO: Enable this after langchain integration
    // new Setting(containerEl)
    //   .setName("Use Notes as context (beta)")
    //   .setDesc(
    //     createFragment((frag) => {
    //       frag.appendText(
    //         "Use your notes as context. Currently only support the active note. "
    //         + "Default to off. Be cautious, this could incur more API costs!"
    //       );
    //     })
    //   )
    //   .addToggle(toggle => toggle
    //     .setValue(this.plugin.settings.useNotesAsContext)
    //     .onChange(async (value) => {
    //       this.plugin.settings.useNotesAsContext = value;
    //       await this.plugin.saveSettings();
    //     })
    //   );

    containerEl.createEl('h4', {text: 'Advanced Settings'});

    new Setting(containerEl)
      .setName("User custom system prompt")
      .setDesc(
        createFragment((frag) => {
          frag.appendText(
            "You can set your own system prompt here. It will override the default system prompt for all messages! Use with caution!"
          );
        })
      )
      .addTextArea(text => {
        text.inputEl.style.width = "200px";
        text.inputEl.style.height = "100px";
        text
          .setPlaceholder("User system prompt")
          .setValue(this.plugin.settings.userSystemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.userSystemPrompt = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl('h4', {text: 'Development mode'});

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Debug mode will log all API requests and prompts to the console.");
        })
      )
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown
          .addOption('true', 'On')
          .addOption('false', 'Off')
          .setValue(this.plugin.settings.debug ? 'true' : 'false')
          .onChange(async (value: string) => {
            this.plugin.settings.debug = value === 'true';
            await this.plugin.saveSettings();
          });
      });
  }
}