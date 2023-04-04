import { WorkspaceLeaf, ItemView } from 'obsidian';
import { SharedState } from '../sharedState';
import * as ReactDOM from 'react-dom';
import * as React from 'react';
import Chat from '../components/Chat';
import { createRoot, Root } from 'react-dom/client';
import { AppContext } from '../context';
import { CHAT_VIEWTYPE } from '../constants';
import CopilotPlugin, {CopilotSettings} from 'src/main';


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
            apiKey={this.settings.openAiApiKey}
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
