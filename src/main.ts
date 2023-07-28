import AIState, { LangChainParams, SetChainOptions } from '@/aiState';
import { ChainType } from '@/chainFactory';
import { AddPromptModal } from "@/components/AddPromptModal";
import CopilotView from '@/components/CopilotView';
import { LanguageModal } from "@/components/LanguageModal";
import { ListPromptModal } from "@/components/ListPromptModal";
import { ToneModal } from "@/components/ToneModal";
import {
  CHAT_VIEWTYPE, DEFAULT_SETTINGS, DEFAULT_SYSTEM_PROMPT
} from '@/constants';
import { CopilotSettingTab } from '@/settings';
import SharedState from '@/sharedState';
import { sanitizeSettings } from "@/utils";
import cors from '@koa/cors';
import { Server } from 'http';
import Koa from 'koa';
import proxy from 'koa-proxies';
import net from 'net';
import { Editor, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import PouchDB from 'pouchdb';


export interface CopilotSettings {
  openAIApiKey: string;
  huggingfaceApiKey: string;
  cohereApiKey: string;
  anthropicApiKey: string;
  azureOpenAIApiKey: string;
  azureOpenAIApiInstanceName: string;
  azureOpenAIApiDeploymentName: string;
  azureOpenAIApiVersion: string;
  azureOpenAIApiEmbeddingDeploymentName: string;
  defaultModel: string;
  defaultModelDisplayName: string;
  temperature: number;
  maxTokens: number;
  contextTurns: number;
  useNotesAsContext: boolean;
  userSystemPrompt: string;
  openAIProxyBaseUrl: string;
  stream: boolean;
  embeddingProvider: string;
  debug: boolean;
}

interface CustomPrompt {
  _id: string;
  _rev?: string;
  prompt: string;
}

export default class CopilotPlugin extends Plugin {
  settings: CopilotSettings;
  // A chat history that stores the messages sent and received
  // Only reset when the user explicitly clicks "New Chat"
  sharedState: SharedState;
  aiState: AIState;
  activateViewPromise: Promise<void> | null = null;
  chatIsVisible = false;
  dbPrompts: PouchDB.Database;
  server: Server| null = null;
  useProxy = true;

  isChatVisible = () => this.chatIsVisible;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    // Always have one instance of sharedState and aiState in the plugin
    this.sharedState = new SharedState();
    const langChainParams = this.getAIStateParams();
    this.aiState = new AIState(langChainParams);
    this.dbPrompts = new PouchDB<CustomPrompt>('copilot_custom_prompts');
    if (this.useProxy) {
      await this.startProxyServer();
    }

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

    this.addCommand({
      id: 'chat-toggle-window-note-area',
      name: 'Toggle Copilot Chat Window in Note Area',
      callback: () => {
        this.toggleViewNoteArea();
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

    this.addCommand({
      id: 'add-custom-prompt',
      name: 'Add custom prompt for selection',
      editorCallback: (editor: Editor) => {
        new AddPromptModal(this.app, async (title: string, prompt: string) => {
          try {
            // Save the prompt to the database
            await this.dbPrompts.put({ _id: title, prompt: prompt });
            new Notice('Custom prompt saved successfully.');
          } catch (e) {
            new Notice('Error saving custom prompt. Please check if the title already exists.');
            console.error(e);
          }
        }).open();
      },
    });

    this.addCommand({
      id: 'apply-custom-prompt',
      name: 'Apply custom prompt to selection',
      editorCallback: (editor: Editor) => {
        this.fetchPromptTitles().then((promptTitles: string[]) => {
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
            if (!promptTitle) {
              new Notice('Please select a prompt title.');
              return;
            }
            try {
              const doc = await this.dbPrompts.get(promptTitle) as CustomPrompt;
              if (!doc.prompt) {
                new Notice(`No prompt found with the title "${promptTitle}".`);
                return;
              }
              this.processSelection(editor, 'applyCustomPromptSelection', doc.prompt);
            } catch (err) {
              if (err.name === 'not_found') {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              } else {
                console.error(err);
                new Notice('An error occurred.');
              }
            }
          }).open();
        });
      },
    });

    this.addCommand({
      id: 'delete-custom-prompt',
      name: 'Delete custom prompt',
      checkCallback: (checking: boolean) => {
        if (checking) {
          return true;
        }

        this.fetchPromptTitles().then((promptTitles: string[]) => {
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
            if (!promptTitle) {
              new Notice('Please select a prompt title.');
              return;
            }

            try {
              const doc = await this.dbPrompts.get(promptTitle);
              if (doc._rev) {
                await this.dbPrompts.remove(doc as PouchDB.Core.RemoveDocument);
                new Notice(`Prompt "${promptTitle}" has been deleted.`);
              } else {
                new Notice(`Failed to delete prompt "${promptTitle}": No revision found.`);
              }
            } catch (err) {
              if (err.name === 'not_found') {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              } else {
                console.error(err);
                new Notice('An error occurred while deleting the prompt.');
              }
            }
          }).open();
        });

        return true;
      },
    });

    this.addCommand({
      id: 'edit-custom-prompt',
      name: 'Edit custom prompt',
      checkCallback: (checking: boolean) => {
        if (checking) {
          return true;
        }

        this.fetchPromptTitles().then((promptTitles: string[]) => {
          new ListPromptModal(this.app, promptTitles, async (promptTitle: string) => {
            if (!promptTitle) {
              new Notice('Please select a prompt title.');
              return;
            }

            try {
              const doc = await this.dbPrompts.get(promptTitle) as CustomPrompt;
              if (doc.prompt) {
                new AddPromptModal(this.app, (title: string, newPrompt: string) => {
                  this.dbPrompts.put({
                    ...doc,
                    prompt: newPrompt,
                  });
                  new Notice(`Prompt "${title}" has been updated.`);
                }, doc._id, doc.prompt, true).open();
              } else {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              }
            } catch (err) {
              if (err.name === 'not_found') {
                new Notice(`No prompt found with the title "${promptTitle}".`);
              } else {
                console.error(err);
                new Notice('An error occurred.');
              }
            }
          }).open();
        });

        return true;
      },
    });
  }

  async onunload() {
    await this.stopProxyServer();
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

  async toggleViewNoteArea() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE);
    leaves.length > 0 ? this.deactivateView() : this.activateViewNoteArea();
  }

  async activateViewNoteArea() {
    this.app.workspace.detachLeavesOfType(CHAT_VIEWTYPE);
    this.activateViewPromise = this.app.workspace.getLeaf(true).setViewState({
      type: CHAT_VIEWTYPE,
      active: true,
    });
    await this.activateViewPromise;
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(CHAT_VIEWTYPE)[0]);
    this.chatIsVisible = true;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async fetchPromptTitles(): Promise<string[]> {
    const response = await this.dbPrompts.allDocs({ include_docs: true });
    return response.rows
      .map(row => (row.doc as CustomPrompt)?._id)
      .filter(Boolean) as string[];
  }

  getAIStateParams(): LangChainParams {
    const {
      openAIApiKey,
      huggingfaceApiKey,
      cohereApiKey,
      anthropicApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      temperature,
      maxTokens,
      contextTurns,
      embeddingProvider,
    } = sanitizeSettings(this.settings);
    return {
      openAIApiKey,
      huggingfaceApiKey,
      cohereApiKey,
      anthropicApiKey,
      azureOpenAIApiKey,
      azureOpenAIApiInstanceName,
      azureOpenAIApiDeploymentName,
      azureOpenAIApiVersion,
      azureOpenAIApiEmbeddingDeploymentName,
      model: this.settings.defaultModel,
      modelDisplayName: this.settings.defaultModelDisplayName,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      systemMessage: this.settings.userSystemPrompt || DEFAULT_SYSTEM_PROMPT,
      chatContextTurns: Number(contextTurns),
      embeddingProvider: embeddingProvider,
      chainType: ChainType.LLM_CHAIN,  // Set LLM_CHAIN as default ChainType
      options: { forceNewCreation: true } as SetChainOptions,
      openAIProxyBaseUrl: this.settings.openAIProxyBaseUrl,
    };
  }

  async startProxyServer() {
    console.log('loading plugin');

    const port = 3001;

    // check if the port is already in use
    const inUse = await this.checkPortInUse(port);

    if (!inUse) {
      // Create a new Koa application
      const app = new Koa();

      app.use(cors());

      // Create and apply the proxy middleware
      app.use(proxy('/', {
        target: 'http://localhost:8080', // your local API
        changeOrigin: true,
      }));

      // Start the server on the specified port
      this.server = app.listen(port);
      console.log(`Proxy server running on http://localhost:${port}`);
    } else {
      console.error(`Port ${port} is in use`);
    }
  }

  async stopProxyServer() {
    console.log('stopping proxy server...');
    if (this.server) {
      this.server.close();
    }
  }

  checkPortInUse(port: number) {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
        .once('error', (err: NodeJS.ErrnoException) => {  // Typecast here
          if (err.code === 'EADDRINUSE') {
            resolve(true);  // Port is in use
          } else {
            reject(err);
          }
        })
        .once('listening', () => {
          server.once('close', () => {
            resolve(false);  // Port is not in use
          })
          .close();
        })
        .listen(port);
    });
  }
}
