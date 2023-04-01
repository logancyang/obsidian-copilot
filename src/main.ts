import { App, Editor, MarkdownView, Modal, Notice, WorkspaceLeaf, Plugin, PluginSettingTab, Setting, addIcon } from 'obsidian';
import ChatGPTView from './chatGPTView';
import { SharedState } from './sharedState';

const CHATGPT_VIEWTYPE = 'chat-gpt-view';

interface CopilotPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: CopilotPluginSettings = {
  mySetting: 'default'
}

export default class CopilotPlugin extends Plugin {
  settings: CopilotPluginSettings;
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;

  async onload() {
    await this.loadSettings();
    // addIcon('refresh-cw', '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>');

    this.sharedState = new SharedState();

    // Register your custom View class
    this.registerView('chat-gpt-view', (leaf) => new ChatGPTView(leaf, this.sharedState));

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
