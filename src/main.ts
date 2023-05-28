import AIState, { LangChainParams } from '@/aiState';
import { LLM_CHAIN } from '@/chainFactory';
import CopilotView from '@/components/CopilotView';
import { LanguageModal } from "@/components/LanguageModal";
import { ToneModal } from "@/components/ToneModal";
import {
  CHAT_VIEWTYPE, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT
} from '@/constants';
import { CopilotSettingTab } from '@/settings';
import SharedState from '@/sharedState';
import { sanitizeSettings } from "@/utils";
import { Editor, Notice, Plugin, WorkspaceLeaf } from 'obsidian';

export interface CopilotSettings {
  openAiApiKey: string;
  huggingfaceApiKey: string;
  defaultModel: string;
  temperature: string;
  maxTokens: string;
  contextTurns: string;
  useNotesAsContext: boolean;
  userSystemPrompt: string;
  stream: boolean;
  embeddingProvider: string;
  debug: boolean;
}

export default class CopilotPlugin extends Plugin {
  settings: CopilotSettings;
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;
  aiState: AIState;
  activateViewPromise: Promise<void> | null = null;
  chatIsVisible = false;

  isChatVisible = () => this.chatIsVisible;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    // Always have one instance of sharedState and aiState in the plugin
    this.sharedState = new SharedState();
    const langChainParams = this.getAIStateParams();
    this.aiState = new AIState(langChainParams);

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
      id: 'summarize-prompt',
      name: 'Summarize selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'summarizeSelection');
      },
    });

    this.addCommand({
      id: 'generate-toc-prompt',
      name: 'Generate table of contents for selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'tocSelection');
      },
    });

    this.addCommand({
      id: 'generate-glossary-prompt',
      name: 'Generate glossary for selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'glossarySelection');
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
      name: 'Make selection shorter',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'rewriteShorterSelection');
      },
    });

    this.addCommand({
      id: 'make-longer-prompt',
      name: 'Make selection longer',
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
      id: 'press-release-prompt',
      name: 'Rewrite selection to a press release',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'rewritePressReleaseSelection');
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

    this.addCommand({
      id: 'count-tokens',
      name: 'Count words and tokens in selection',
      editorCallback: (editor: Editor) => {
        this.processSelection(editor, 'countTokensSelection');
      },
    });
  }

  processSelection(editor: Editor, eventType: string, eventSubtype?: string) {
    if (editor.somethingSelected() === false) {
      new Notice('Please select some text to rewrite.');
      return;
    }
    const selectedText = editor.getSelection();

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
    this.activateViewPromise = this.app.workspace.getRightLeaf(false).setViewState({
      type: CHAT_VIEWTYPE,
      active: true,
    });
    await this.activateViewPromise;
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]);
    this.chatIsVisible = true;
  }

  async deactivateView() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    this.chatIsVisible = false;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getAIStateParams(): LangChainParams {
    const {
      openAiApiKey,
      huggingfaceApiKey,
      temperature,
      maxTokens,
      contextTurns,
      embeddingProvider,
    } = sanitizeSettings(this.settings);
    return {
      key: openAiApiKey,
      huggingfaceApiKey: huggingfaceApiKey,
      model: this.settings.defaultModel,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      systemMessage: DEFAULT_SYSTEM_PROMPT || this.settings.userSystemPrompt,
      chatContextTurns: Number(contextTurns),
      embeddingProvider: embeddingProvider,
      chainType: LLM_CHAIN,
    };
  }
}
