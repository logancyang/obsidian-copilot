import { Plugin, WorkspaceLeaf } from 'obsidian';
import { CopilotSettingTab } from 'src/settings';
import SharedState from 'src/sharedState';
import CopilotView from 'src/components/CopilotView';
import { CHAT_VIEWTYPE } from 'src/constants';


export interface CopilotSettings {
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

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    this.sharedState = new SharedState();

    this.registerView(
      CHAT_VIEWTYPE,
      (leaf: WorkspaceLeaf) => new CopilotView(leaf, this)
    );

    this.addRibbonIcon('message-square', 'Copilot Chat', (evt: MouseEvent) => {
      // open or close the chatgpt view
      this.toggleView();
    });
  }

  toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    leaves.length > 0 ? this.deactivateView() : this.activateView();
  }

  async activateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: CHAT_VIEWTYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]);
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
