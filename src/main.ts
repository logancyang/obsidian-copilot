import { App, Modal, Plugin } from 'obsidian';
import { CopilotSettingTab } from "./settings";
import ChatGPTView from './chatGptView';
import { SharedState } from './sharedState';

const CHATGPT_VIEWTYPE = 'chat-gpt-view';

interface CopilotSettings {
  openAiApiKey: string;
  defaultModel: string;
}

const DEFAULT_SETTINGS: Partial<CopilotSettings> = {
  openAiApiKey: '',
  defaultModel: 'gpt-3.5-turbo',
}

export default class CopilotPlugin extends Plugin {
  settings: CopilotSettings;
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new CopilotSettingTab(this.app, this));

    this.sharedState = new SharedState();

    // Register your custom View class
    this.registerView(
      'chat-gpt-view',
      (leaf) => new ChatGPTView(leaf, this));

    this.addRibbonIcon('message-square', 'ChatGPT', (evt: MouseEvent) => {
      // open or close the chatgpt view
      this.toggleView();
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
