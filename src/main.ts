import { App, Editor, MarkdownView, Modal, Notice, WorkspaceLeaf, Plugin, PluginSettingTab, Setting } from 'obsidian';
import ChatGPTView from './ChatGPTView';

const CHATGPT_VIEWTYPE = 'chat-gpt-view';

interface CopilotPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: CopilotPluginSettings = {
  mySetting: 'default'
}

export default class CopilotPlugin extends Plugin {
  settings: CopilotPluginSettings;

  async onload() {
    await this.loadSettings();
    // Register your custom View class
    this.registerView('chat-gpt-view', (leaf) => new ChatGPTView(leaf));

    this.addRibbonIcon('message-square', 'ChatGPT', (evt: MouseEvent) => {
      // open or close the chatgpt view
      this.toggleView();
    });
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHATGPT_VIEWTYPE);
    leaves.length > 0 ? this.deactivateView() : this.activateView();
  }

  async activateView() {
    this.app.workspace.detachLeavesOfType(CHATGPT_VIEWTYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: CHATGPT_VIEWTYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHATGPT_VIEWTYPE)[0]);
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHATGPT_VIEWTYPE);
  }

  onunload() {
    console.log('unloading plugin');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class SampleModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    contentEl.setText('Woah!');
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: CopilotPlugin;

  constructor(app: App, plugin: CopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;

    containerEl.empty();

    containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

    new Setting(containerEl)
      .setName('Setting #1')
      .setDesc('It\'s a secret')
      .addText(text => text
        .setPlaceholder('Enter your secret')
        .setValue(this.plugin.settings.mySetting)
        .onChange(async (value) => {
          console.log('Secret: ' + value);
          this.plugin.settings.mySetting = value;
          await this.plugin.saveSettings();
        }));
  }
}
