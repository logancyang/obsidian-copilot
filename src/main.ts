import CopilotView from '@/components/CopilotView';
import {
  CHAR_LENGTH_LIMIT, CHAT_VIEWTYPE, DEFAULT_SETTINGS,
} from '@/constants';
import { CopilotSettingTab } from '@/settings';
import SharedState from '@/sharedState';
import { Editor, Notice, Plugin, WorkspaceLeaf } from 'obsidian';


export interface CopilotSettings {
  openAiApiKey: string;
  defaultModel: string;
  temperature: string;
  maxTokens: string;
  contextTurns: string;
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

    this.addCommand({
      id: 'copilot-chat-toggle-window',
      name: 'Toggle Copilot Chat Window',
      callback: () => {
        this.toggleView();
      }
    });

    this.addRibbonIcon('message-square', 'Copilot Chat', (evt: MouseEvent) => {
      this.toggleView();
    });

    this.addCommand({
      id: 'copilot-simplify-prompt',
      name: 'Simplify selection',
      editorCallback: (editor: Editor) => {
        if (editor.somethingSelected() === false) {
          new Notice('Please select some text to rewrite.');
          return;
        }
        const selectedText = editor.getSelection();
        if (selectedText.length > CHAR_LENGTH_LIMIT) {
          new Notice('Selection is too long, please select less than 5800 characters.');
          return;
        }

        const activeCopilotView = this.app.workspace
          .getLeavesOfType(CHAT_VIEWTYPE)
          .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;

        if (selectedText && activeCopilotView) {
          activeCopilotView.emitter.emit('simplifySelection', selectedText);
        }
      },
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
