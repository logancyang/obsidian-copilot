import AIState from '@/aiState';
import Chat from '@/components/Chat';
import { CHAT_VIEWTYPE } from '@/constants';
import { AppContext } from '@/context';
import CopilotPlugin from '@/main';
import SharedState from '@/sharedState';
import { EventEmitter } from 'events';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as React from 'react';
import { Root, createRoot } from 'react-dom/client';


export default class CopilotView extends ItemView {
  private sharedState: SharedState;
  private aiState: AIState;
  private model: string;
  private root: Root | null = null;
  private debug = false;
  emitter: EventEmitter;
  userSystemPrompt = '';
  useNotesAsContext = false;

  constructor(leaf: WorkspaceLeaf, private plugin: CopilotPlugin) {
    super(leaf);
    this.sharedState = plugin.sharedState;
    this.app = plugin.app;
    this.aiState = plugin.aiState;
    this.model = plugin.settings.defaultModel;
    this.debug = plugin.settings.debug;
    this.emitter = new EventEmitter();
    this.getChatVisibility = this.getChatVisibility.bind(this);
    this.userSystemPrompt = plugin.settings.userSystemPrompt;
    this.useNotesAsContext = plugin.settings.useNotesAsContext;
  }

  getViewType(): string {
    return CHAT_VIEWTYPE;
  }

  // Return an icon for this view
  getIcon(): string {
    return 'message-square';
  }

  // Return a title for this view
  getTitle(): string {
    return 'Copilot Chat';
  }

  getDisplayText(): string {
    return 'Copilot';
  }

  async getChatVisibility(){
    if (this.plugin.activateViewPromise) {
      await this.plugin.activateViewPromise;
    }
    return this.plugin.isChatVisible();
  }

  async onOpen(): Promise<void> {
    const root = createRoot(this.containerEl.children[1]);
    root.render(
      <AppContext.Provider value={this.app}>
        <React.StrictMode>
          <Chat
            sharedState={this.sharedState}
            aiState={this.aiState}
            emitter={this.emitter}
            getChatVisibility={this.getChatVisibility}
            debug={this.debug}
          />
        </React.StrictMode>
      </AppContext.Provider>
    );
  }

  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
    }
  }
}
