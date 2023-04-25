import CopilotView from '@/components/CopilotView';
import { LanguageModal } from "@/components/LanguageModal";
import { ToneModal } from "@/components/ToneModal";
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
      id: 'chat-toggle-window',
      name: 'Toggle Copilot Chat Window',
      callback: () => {
        this.toggleView();
      }
    });

    this.addRibbonIcon('message-square', 'Copilot Chat', (evt: MouseEvent) => {
      this.toggleView();
    });

    this.addCommand({
      id: 'fix-grammar-prompt',
      name: 'Fix grammar and spelling of selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'fixGrammarSpellingSelection');
      },
    });

    this.addCommand({
      id: 'simplify-prompt',
      name: 'Simplify selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'simplifySelection');
      },
    });

    this.addCommand({
      id: 'emojify-prompt',
      name: 'Emojify selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'emojifySelection');
      },
    });

    this.addCommand({
      id: 'remove-urls-prompt',
      name: 'Remove URLs from selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'removeUrlsFromSelection');
      },
    });

    this.addCommand({
      id: 'rewrite-tweet-prompt',
      name: 'Rewrite selection to a tweet',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'rewriteTweetSelection');
      },
    });

    this.addCommand({
      id: 'rewrite-tweet-thread-prompt',
      name: 'Rewrite selection to a tweet thread',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'rewriteTweetThreadSelection');
      },
    });

    this.addCommand({
      id: 'make-shorter-prompt',
      name: 'Rewrite selection to make it shorter',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'rewriteShorterSelection');
      },
    });

    this.addCommand({
      id: 'make-longer-prompt',
      name: 'Rewrite selection to make it longer',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'rewriteLongerSelection');
      },
    });

    this.addCommand({
      id: 'eli5-prompt',
      name: 'Explain selection like I\'m 5',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'eli5Selection');
      },
    });

    this.addCommand({
      id: 'translate-selection-prompt',
      name: 'Translate selection',
      editorCallback: (editor: Editor) => {
        new LanguageModal(this.app, (language) => {
          if (!language) {
            new Notice('Please select a language.');
            return;
          }
          this.processSelection(editor, 'translateSelection', language);
        }).open();
      },
    });

    this.addCommand({
      id: 'change-tone-prompt',
      name: 'Change tone of selection',
      editorCallback: (editor: Editor) => {
        new ToneModal(this.app, (tone) => {
          if (!tone) {
            new Notice('Please select a tone.');
            return;
          }
          this.processSelection(editor, 'changeToneSelection', tone);
        }).open();
      },
    });
  }

  processSelection(editor: Editor, eventType: string, eventSubtype?: string) {
    if (editor.somethingSelected() === false) {
      new Notice('Please select some text to rewrite.');
      return;
    }
    const selectedText = editor.getSelection();
    if (selectedText.length > CHAR_LENGTH_LIMIT) {
      new Notice('Selection is too long, please select less than 5800 characters.');
      return;
    }

    const isChatWindowActive = this.app.workspace
      .getLeavesOfType(CHAT_VIEWTYPE).length > 0;

    if (!isChatWindowActive) {
      this.activateView();
    }

    setTimeout(() => {
      // Without the timeout, the view is not yet active
      const activeCopilotView = this.app.workspace
        .getLeavesOfType(CHAT_VIEWTYPE)
        .find((leaf) => leaf.view instanceof CopilotView)?.view as CopilotView;
      if (selectedText && activeCopilotView) {
        activeCopilotView.emitter.emit(eventType, selectedText, eventSubtype);
      }
    }, 0);
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
