import Chat from '@/components/Chat';
import { CHAT_VIEWTYPE } from '@/constants';
import { AppContext } from '@/context';
import CopilotPlugin, { CopilotSettings } from '@/main';
import SharedState from '@/sharedState';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as React from 'react';
import { Root, createRoot } from 'react-dom/client';


export default class CopilotView extends ItemView {
  private sharedState: SharedState;
  private settings: CopilotSettings;
  private model: string;
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CopilotPlugin) {
    super(leaf);
    this.sharedState = plugin.sharedState;
    this.app = plugin.app;
    this.settings = plugin.settings;
    this.model = plugin.settings.defaultModel;
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

  async onOpen(): Promise<void> {
    const root = createRoot(this.containerEl.children[1]);
    root.render(
      <AppContext.Provider value={this.app}>
        <React.StrictMode>
          <Chat
            sharedState={this.sharedState}
            settings={this.settings}
            model={this.model}
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
