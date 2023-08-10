import {
  AZURE_OPENAI,
  COHEREAI,
  ChatModelDisplayNames,
  DEFAULT_SETTINGS,
  DISPLAY_NAME_TO_MODEL,
  HUGGINGFACE,
  LOCALAI,
  OPENAI,
} from "@/constants";
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
    containerEl.createEl('h2', { text: 'Copilot Settings' });

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
      { text: 'Please reload the plugin when you change any setting below.' }
    );

    const modelDisplayNames = [
      ChatModelDisplayNames.GPT_35_TURBO,
      ChatModelDisplayNames.GPT_35_TURBO_16K,
      ChatModelDisplayNames.GPT_4,
      ChatModelDisplayNames.GPT_4_32K,
      // ChatModelDisplayNames.CLAUDE_1,
      // ChatModelDisplayNames.CLAUDE_1_100K,
      // ChatModelDisplayNames.CLAUDE_INSTANT_1,
      // ChatModelDisplayNames.CLAUDE_INSTANT_1_100K,
      ChatModelDisplayNames.AZURE_GPT_35_TURBO,
      ChatModelDisplayNames.AZURE_GPT_35_TURBO_16K,
      ChatModelDisplayNames.AZURE_GPT_4,
      ChatModelDisplayNames.AZURE_GPT_4_32K,
    ];

    new Setting(containerEl)
      .setName("Default Model")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("The default model to use, only takes effect when you ");
          frag.createEl('strong', { text: "restart the plugin" });
        })
      )
      .addDropdown((dropdown: DropdownComponent) => {
        modelDisplayNames.forEach(displayName => {
          dropdown.addOption(displayName, displayName);
        });
        dropdown
          .setValue(this.plugin.settings.defaultModelDisplayName)
          .onChange(async (value: string) => {
            this.plugin.settings.defaultModelDisplayName = value;
            this.plugin.settings.defaultModel = DISPLAY_NAME_TO_MODEL[this.plugin.settings.defaultModelDisplayName];
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl('h4', { text: 'API Settings' });
    containerEl.createEl('h6', { text: 'OpenAI API' });

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
            { text: "path_to_your_vault/.obsidian/plugins/obsidian-copilot/data.json" }
          );
          frag.appendText(", and it is only used to make requests to OpenAI.");
        })
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("OpenAI API key")
          .setValue(this.plugin.settings.openAIApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAIApiKey = value;
            await this.plugin.saveSettings();
          })
      }
      );

    // containerEl.createEl('h6', { text: 'Anthropic' });

    // new Setting(containerEl)
    //   .setName("Your Anthropic API key")
    //   .setDesc(
    //     createFragment((frag) => {
    //       frag.appendText("This is for Claude models. Sign up on their waitlist if you don't have access.");
    //       frag.createEl('a', {
    //         text: "https://docs.anthropic.com/claude/docs/getting-access-to-claude",
    //         href: "https://docs.anthropic.com/claude/docs/getting-access-to-claude"
    //       });
    //     })
    //   )
    //   .addText((text) => {
    //     text.inputEl.type = "password";
    //     text.inputEl.style.width = "100%";
    //     text
    //       .setPlaceholder("Anthropic API key")
    //       .setValue(this.plugin.settings.anthropicApiKey)
    //       .onChange(async (value) => {
    //         this.plugin.settings.anthropicApiKey = value;
    //         await this.plugin.saveSettings();
    //       })
    //   }
    //   );

    containerEl.createEl('h6', { text: 'Azure OpenAI API' });

    new Setting(containerEl)
      .setName("Your Azure OpenAI API key")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("This is for Azure OpenAI APIs. Sign up on their waitlist if you don't have access.");
        })
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("Azure OpenAI API key")
          .setValue(this.plugin.settings.azureOpenAIApiKey)
          .onChange(async (value) => {
            this.plugin.settings.azureOpenAIApiKey = value;
            await this.plugin.saveSettings();
          })
      }
      );

    new Setting(containerEl)
      .setName("Your Azure OpenAI instance name")
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("Azure OpenAI instance name")
          .setValue(this.plugin.settings.azureOpenAIApiInstanceName)
          .onChange(async (value) => {
            this.plugin.settings.azureOpenAIApiInstanceName = value;
            await this.plugin.saveSettings();
          })
      }
      );

    new Setting(containerEl)
      .setName("Your Azure OpenAI deployment name")
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("Azure OpenAI deployment name")
          .setValue(this.plugin.settings.azureOpenAIApiDeploymentName)
          .onChange(async (value) => {
            this.plugin.settings.azureOpenAIApiDeploymentName = value;
            await this.plugin.saveSettings();
          })
      }
      );

    new Setting(containerEl)
      .setName("Your Azure OpenAI API version")
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("Azure OpenAI API version")
          .setValue(this.plugin.settings.azureOpenAIApiVersion)
          .onChange(async (value) => {
            this.plugin.settings.azureOpenAIApiVersion = value;
            await this.plugin.saveSettings();
          })
      }
      );

    new Setting(containerEl)
      .setName("Your Azure OpenAI embedding model deployment name (Optional)")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Only if you'd like to use Azure as the embedding provider.");
        })
      )
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("Azure OpenAI embedding model deployment name")
          .setValue(this.plugin.settings.azureOpenAIApiEmbeddingDeploymentName)
          .onChange(async (value) => {
            this.plugin.settings.azureOpenAIApiEmbeddingDeploymentName = value;
            await this.plugin.saveSettings();
          })
      }
      );

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
      .addSlider(slider =>
        slider
          .setLimits(0, 2, 0.05)
          .setValue(
            this.plugin.settings.temperature !== undefined &&
              this.plugin.settings.temperature !== null ?
              this.plugin.settings.temperature : 0.7
          )
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.temperature = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Token limit")
      .setDesc(
        createFragment((frag) => {
          frag.appendText(
            "The maximum number of tokens to generate. Default is 1000."
          );
          frag.createEl(
            'strong',
            {
              text: 'This number plus the length of your prompt must be smaller than the context window of the model.'
            }
          )
        })
      )
      .addSlider(slider =>
        slider
          .setLimits(0, 8000, 100)
          .setValue(
            this.plugin.settings.maxTokens !== undefined &&
              this.plugin.settings.maxTokens !== null ?
              this.plugin.settings.maxTokens : 1000
          )
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.maxTokens = value;
            await this.plugin.saveSettings();
          })
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
      .addSlider(slider =>
        slider
          .setLimits(1, 10, 1)
          .setValue(
            this.plugin.settings.contextTurns !== undefined &&
              this.plugin.settings.contextTurns !== null ?
              this.plugin.settings.contextTurns : 3
          )
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.contextTurns = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h4', { text: 'Vector-based QA Settings (BETA). No context limit!' });
    containerEl.createEl('h6', { text: 'To start the QA session, use the Mode Selection dropdown and select "QA: Active Note". Switch back to "Conversation" when you are done!' });
    containerEl.createEl(
      'h6',
      {
        text: 'NOTE: OpenAI embeddings are not free but may give better QA results. CohereAI (recommended) offers trial API for FREE and the quality is very good! It is more stable than Huggingface Inference API. Huggingface embeddings are also free but the result is not as good, and you may see more API timeout errors. '
      }
    );

    new Setting(containerEl)
      .setName("Embedding Provider")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("The embedding provider to use, only takes effect when you ");
          frag.createEl('strong', { text: "restart the plugin" });
        })
      )
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown
          .addOption(OPENAI, 'OpenAI')
          .addOption(COHEREAI, 'CohereAI')
          .addOption(AZURE_OPENAI, 'Azure OpenAI')
          .addOption(HUGGINGFACE, 'Huggingface')
          .addOption(LOCALAI, 'LocalAI')
          .setValue(this.plugin.settings.embeddingProvider)
          .onChange(async (value: string) => {
            this.plugin.settings.embeddingProvider = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("TTL (Days)")
      .setDesc("Specify the Time To Live (TTL) for the saved embeddings in days. Default is 30 days. Embeddings older than the TTL will be deleted automatically to save storage space.")
      .addText((text) => {
        text
          .setPlaceholder("30")
          .setValue(this.plugin.settings.ttlDays ? this.plugin.settings.ttlDays.toString() : '')
          .onChange(async (value: string) => {
            const intValue = parseInt(value);
            if (!isNaN(intValue)) {
              this.plugin.settings.ttlDays = intValue;
              await this.plugin.saveSettings();
            }
          });
      });


    new Setting(containerEl)
      .setName("Your CohereAI trial API key")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("You can sign up at CohereAI and find your API key at ");
          frag.createEl('a', {
            text: "https://dashboard.cohere.ai/api-keys",
            href: "https://dashboard.cohere.ai/api-keys"
          });
          frag.createEl('br');
          frag.appendText("It is used to make requests to CohereAI trial API for free embeddings.");
        })
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.style.width = "80%";
        text
          .setPlaceholder("CohereAI trial API key")
          .setValue(this.plugin.settings.cohereApiKey)
          .onChange(async (value) => {
            this.plugin.settings.cohereApiKey = value;
            await this.plugin.saveSettings();
          })
      }
      );

    new Setting(containerEl)
      .setName("Your Huggingface Inference API key")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("You can find your API key at ");
          frag.createEl('a', {
            text: "https://hf.co/settings/tokens",
            href: "https://hf.co/settings/tokens"
          });
          frag.createEl('br');
          frag.appendText("It is used to make requests to Huggingface Inference API for free embeddings.");
          frag.createEl('br');
          frag.createEl('strong', {
            text: "Please note that the quality may be worse than OpenAI embeddings,"
          });
          frag.createEl('br');
          frag.createEl('strong', {
            text: "and may have more API timeout errors."
          });
        })
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.style.width = "80%";
        text
          .setPlaceholder("Huggingface Inference API key")
          .setValue(this.plugin.settings.huggingfaceApiKey)
          .onChange(async (value) => {
            this.plugin.settings.huggingfaceApiKey = value;
            await this.plugin.saveSettings();
          })
      }
      );

    containerEl.createEl('h4', { text: 'Local Copilot (EXPERIMENTAL, NO INTERNET NEEDED!!)' });
    containerEl.createEl('p', { text: 'To use Local Copilot, please check the doc to set up LocalAI server on your device. Once ready,' });
    containerEl.createEl('p', { text: '1. Set OpenAI Proxy Base URL to http://localhost:8080/v1 under Advanced Settings.' });
    containerEl.createEl('p', { text: '2. Type in the LocalAI Model name you have below.' });
    containerEl.createEl('p', { text: '3. Pick LocalAI in the Copilot Chat model selection dropdown to chat with it!' });
    containerEl.createEl('p', { text: 'Local models can be limited in capabilities and may not work for some use cases at this time. Keep in mind that it is still in early experimental phase. But it is definitely fun to try out!' });
    containerEl.createEl('h6', { text: 'When you are done, clear the OpenAI Proxy Base URL to switch back to non-local models.' });

    new Setting(containerEl)
      .setName("LocalAI Model")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("The local model you'd like to use. Make sure you download that model in your LocalAI models directory.");
          frag.createEl('br');
          frag.appendText("NOTE: Please set OpenAI Proxy Base URL to http://localhost:8080/v1 under Advanced Settings")
        })
      )
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("llama-2-uncensored-q4ks")
          .setValue(this.plugin.settings.localAIModel)
          .onChange(async (value) => {
            this.plugin.settings.localAIModel = value;
            await this.plugin.saveSettings();
          })
      });

    containerEl.createEl('h4', { text: 'Advanced Settings' });

    new Setting(containerEl)
      .setName("User custom system prompt")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("You can set your own system prompt here. ")
          frag.createEl(
            'strong',
            { text: "Warning: It will override the default system prompt for all messages! " }
          );
          frag.appendText(
            "Use with caution! Also note that OpenAI can return error codes for some system prompts."
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

    new Setting(containerEl)
      .setName("OpenAI Proxy Base URL (3rd-party providers)")
      .setDesc(
        createFragment((frag) => {
          frag.createEl(
            'strong',
            { text: "CAUTION: This will override the default OpenAI API URL! Use with discretion!" }
          );
          frag.createEl('br');
          frag.appendText("Leave blank to use the official OpenAI API.");
        })
      )
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("https://openai.example.com/v1")
          .setValue(this.plugin.settings.openAIProxyBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.openAIProxyBaseUrl = value;
            await this.plugin.saveSettings();
          })
      });

    containerEl.createEl('h4', { text: 'Development mode' });

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Debug mode will log all API requests and prompts to the console.");
        })
      )
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debug)
        .onChange(async (value) => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
        })
      );
  }
}