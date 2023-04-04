import { App, WorkspaceLeaf, ItemView } from 'obsidian';
import { SharedState } from '../sharedState';
import * as ReactDOM from 'react-dom';
import * as React from 'react';
import Chat from '../components/Chat';
import { createRoot } from 'react-dom/client';
import { AppContext } from '../context';
import { CHAT_VIEWTYPE } from '../constants';


export default class CopilotView extends ItemView {
  private sharedState: SharedState;

  constructor(app: App, leaf: WorkspaceLeaf, sharedState: SharedState) {
    super(leaf);
    this.sharedState = sharedState;
    this.app = app;
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
          <Chat sharedState={this.sharedState} />
        </React.StrictMode>
      </AppContext.Provider>
    );
  }

  async onClose(): Promise<void> {
    ReactDOM.unmountComponentAtNode(this.containerEl.children[1]);
  }
}
